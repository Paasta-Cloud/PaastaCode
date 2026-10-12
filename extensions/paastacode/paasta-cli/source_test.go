package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

func sourceFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for name, content := range files {
		filename := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func sourcePaths(selection *sourceSelection) []string {
	paths := []string{}
	for _, file := range selection.Files {
		paths = append(paths, file.Path)
	}
	return paths
}

func captureStdout(t *testing.T, action func()) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	original := os.Stdout
	defer func() { os.Stdout = original }()
	os.Stdout = file
	action()
	if _, err := file.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestSourceExclusionsPrecedeLimitsAndStayWithinRoot(t *testing.T) {
	root := sourceFixture(t, map[string]string{".gitignore": "*.js\n", "app/.paastaignore": "huge.dat\n", "app/main.js": "keep"})
	file, err := os.Create(filepath.Join(root, "app", "huge.dat"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxProjectSourceBytes + 1); err != nil {
		t.Fatal(err)
	}
	file.Close()
	selection, err := selectSource(filepath.Join(root, "app"))
	if err != nil {
		t.Fatal(err)
	}
	if len(selection.Files) != 2 {
		t.Fatal("parent rules leaked or ignored file counted toward limit")
	}
	if err := os.WriteFile(filepath.Join(root, "app", ".paastaignore"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectSource(filepath.Join(root, "app")); err == nil {
		t.Fatal("source size limit missing")
	}
}

func TestSourceIgnorePrecedenceAndEnvironment(t *testing.T) {
	root := sourceFixture(t, map[string]string{
		".gitignore": "dist/\n.env\n", "src/.gitignore": "*.js\n",
		".paastaignore": "*.log\n!.env\nprivate/\n.env.local\n",
		"src/main.js":   "app", "dist/app.js": "build", "debug.log": "skip",
		".env": "INCLUDED=yes\n", ".env.local": "EXCLUDED=no\n", "private/.env": "PRIVATE=no\n",
	})
	selection, err := selectSource(root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{".gitignore", ".paastaignore", "dist/app.js", "src/.gitignore", "src/main.js"}
	if !reflect.DeepEqual(sourcePaths(selection), want) {
		t.Fatalf("paths: %v", sourcePaths(selection))
	}
	if !reflect.DeepEqual(selection.IgnoreFiles, []string{".paastaignore"}) {
		t.Fatal(selection.IgnoreFiles)
	}
	env, count, err := selection.collectEnvironment()
	if err != nil || count != 1 || len(env) != 1 || env["INCLUDED"] != "yes" {
		t.Fatalf("environment selection: count=%d err=%v", count, err)
	}
	archive, count, size, err := selection.archive()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	actual := []string{}
	var total int64
	for _, file := range reader.File {
		actual = append(actual, file.Name)
		total += int64(file.UncompressedSize64)
	}
	if !reflect.DeepEqual(actual, want) || count != len(want) || size != total || size != selection.Bytes {
		t.Fatalf("archive differs from preview: %v", actual)
	}
	if err := os.WriteFile(filepath.Join(root, ".paastaignore"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	selection, err = selectSource(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(sourcePaths(selection), "\n"), "dist/app.js") {
		t.Fatal("empty .paastaignore must disable Git fallback")
	}
}

func TestSourceGitIgnoreScopesAndNegation(t *testing.T) {
	root := sourceFixture(t, map[string]string{
		".gitignore":    "/root-only.txt\n*.log\nignored/\n!ignored/keep.txt\n.env\n",
		"root-only.txt": "skip", "sub/root-only.txt": "keep", "debug.log": "skip",
		"sub/.gitignore": "!keep.log\n/local.txt\n", "sub/keep.log": "keep", "sub/local.txt": "skip",
		"other/keep.log": "skip", "other/local.txt": "keep", "ignored/keep.txt": "skip",
		"ignored/.gitignore": "!keep.txt\n", ".env": "NEVER_UPLOAD=secret\n", "sub/.env": "NEVER_UPLOAD=secret\n",
	})
	selection, err := selectSource(root)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{".gitignore", "other/local.txt", "sub/.gitignore", "sub/keep.log", "sub/root-only.txt"}
	if !reflect.DeepEqual(sourcePaths(selection), want) {
		t.Fatalf("paths: %v", sourcePaths(selection))
	}
	if len(selection.EnvironmentFiles) != 0 {
		t.Fatal("ignored environment files selected")
	}
	if !reflect.DeepEqual(selection.IgnoreFiles, []string{".gitignore", "sub/.gitignore"}) {
		t.Fatal(selection.IgnoreFiles)
	}
}

func TestSourcePatternsMatchGit(t *testing.T) {
	patterns := "\ufeff# comment\r\n*.log\r\n!keep.log\r\n/root.txt\ncache/\na/**/b.txt\n**/deep?.[ch]\nrange[!0-9].txt\n\\#literal\n\\!literal\nspace\\ \n leading.txt\ntrail.txt   \nfoo/*\n!foo/keep.txt\n"
	root := sourceFixture(t, map[string]string{".gitignore": patterns})
	rules, _, err := readSourceIgnore(root, ".gitignore")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name               string
		directory, ignored bool
	}{
		{"x.log", false, true}, {"keep.log", false, false}, {"sub/x.log", false, true}, {"sub/keep.log", false, false},
		{"root.txt", false, true}, {"sub/root.txt", false, false}, {"cache", true, true}, {"cache", false, false},
		{"a/b.txt", false, true}, {"a/x/y/b.txt", false, true}, {"a/x/b/c/b.txt", false, true}, {"other/a/b.txt", false, false},
		{"deep1.c", false, true}, {"x/y/deepZ.h", false, true}, {"deep12.c", false, false}, {"rangea.txt", false, true}, {"range1.txt", false, false},
		{"#literal", false, true}, {"!literal", false, true}, {"space ", false, true}, {"space", false, false},
		{" leading.txt", false, true}, {"leading.txt", false, false}, {"trail.txt", false, true},
		{"foo/drop.txt", false, true}, {"foo/keep.txt", false, false}, {"other/foo/drop.txt", false, false},
	}
	for _, test := range cases {
		if got := sourceIgnored(test.name, test.directory, rules); got != test.ignored {
			t.Errorf("%q: got %v want %v", test.name, got, test.ignored)
		}
	}
	// Git is only a test oracle; released binaries do not require it.
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable for parity check")
	}
	if output, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", output, err)
	}
	for _, test := range cases {
		if test.directory {
			continue
		}
		cmd := exec.Command("git", "-C", root, "-c", "core.excludesFile=", "check-ignore", "--no-index", "-q", "--", test.name)
		err := cmd.Run()
		if err != nil {
			if status, ok := err.(*exec.ExitError); !ok || status.ExitCode() != 1 {
				t.Fatal(err)
			}
		}
		if (err == nil) != test.ignored {
			t.Errorf("Git parity differs for %q", test.name)
		}
	}
}

func TestSourceBuiltinsCannotBeReincluded(t *testing.T) {
	root := sourceFixture(t, map[string]string{
		".paastaignore": "!*\n!**/*\n", "app.js": "app", "server.key": "private", "cert.pem": "private",
		"node_modules/a.js": "skip", ".git/config": "skip", ".paasta/config.json": "skip",
		".next/out.js": "skip", ".env": "TOKEN=value\n", ".env.example": "TOKEN=example\n",
	})
	selection, err := selectSource(root)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{".env.example", ".paastaignore", "app.js"}; !reflect.DeepEqual(sourcePaths(selection), want) {
		t.Fatal(sourcePaths(selection))
	}
	if !reflect.DeepEqual(selection.EnvironmentFiles, []string{".env"}) {
		t.Fatal(selection.EnvironmentFiles)
	}
}

func TestSourceSymlinksAndInvalidIgnoreFailClosed(t *testing.T) {
	root := sourceFixture(t, map[string]string{"app.js": "app"})
	out := sourceFixture(t, map[string]string{"private.txt": "private"})
	if err := os.Symlink(filepath.Join(out, "private.txt"), filepath.Join(root, "linked.txt")); err == nil {
		selection, err := selectSource(root)
		if err != nil || len(selection.Files) != 1 {
			t.Fatalf("symlink selected: %v", err)
		}
		if err := os.Symlink(filepath.Join(out, "private.txt"), filepath.Join(root, ".paastaignore")); err != nil {
			t.Fatal(err)
		}
		if _, err := selectSource(root); err == nil {
			t.Fatal("symlink ignore must fail closed")
		}
		if err := os.Remove(filepath.Join(root, ".paastaignore")); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, ".paastaignore"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := selectSource(root); err == nil {
		t.Fatal("directory ignore must fail closed")
	}
	if err := os.Remove(filepath.Join(root, ".paastaignore")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".paastaignore"), []byte("[invalid\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := selectSource(root); err == nil {
		t.Fatal("invalid pattern must fail closed")
	}
}

func TestDryRunOfflineAndNoEnvironmentValues(t *testing.T) {
	root := sourceFixture(t, map[string]string{"app.js": "app", ".env": "TOKEN=never-print-this-value\n"})
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	// Both the CLI dispatcher and direct deploy (used by MCP) must stop locally.
	for _, argv := range [][]string{{"deploy", root, "--dry-run", "--json"}, {"deploy", "--dry-run", "--json", root}} {
		command := parse(argv)
		if !reflect.DeepEqual(command.Positionals, []string{root}) {
			t.Fatal(command)
		}
		output := captureStdout(t, func() {
			if err := run(command); err != nil {
				t.Fatal(err)
			}
		})
		var selection sourceSelection
		if err := json.Unmarshal([]byte(output), &selection); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(output, "never-print") || strings.Contains(output, "TOKEN") || len(selection.Files) != 1 || len(selection.EnvironmentFiles) != 1 {
			t.Fatalf("invalid preview: %s", output)
		}
		captureStdout(t, func() {
			if err := deploy(command, config{Server: "http://127.0.0.1:1"}); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, flag := range []string{"--git", "--image"} {
		if err := run(parse([]string{"deploy", "--dry-run", flag, "example"})); err == nil {
			t.Fatal("remote preview accepted")
		}
	}
}

func TestDryRunMainDoesNotCheckUpdates(t *testing.T) {
	if os.Getenv("PAASTA_TEST_DRY_RUN_CHILD") == "true" {
		os.Args = []string{"paasta", "deploy", os.Getenv("PAASTA_TEST_SOURCE"), "--dry-run", "--json", "--server", os.Getenv("PAASTA_TEST_SERVER")}
		main()
		os.Exit(0)
	}
	root := sourceFixture(t, map[string]string{"main.js": "ok"})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		io.WriteString(w, `{"version":"99.0.0"}`)
	}))
	defer server.Close()
	cmd := exec.Command(os.Args[0], "-test.run=^TestDryRunMainDoesNotCheckUpdates$")
	cmd.Env = append(os.Environ(), "PAASTA_TEST_DRY_RUN_CHILD=true", "PAASTA_TEST_SOURCE="+root, "PAASTA_TEST_SERVER="+server.URL)
	body, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("offline CLI: %s %v", body, err)
	}
	if requests.Load() != 0 {
		t.Fatal("dry-run contacted the server")
	}
	var selection sourceSelection
	if err := json.Unmarshal(body, &selection); err != nil || len(selection.Files) != 1 {
		t.Fatalf("preview: %s %v", body, err)
	}
}

func TestDockerIgnoreDoesNotFilterUpload(t *testing.T) {
	root := sourceFixture(t, map[string]string{".dockerignore": "app.js\n", "app.js": "app"})
	selection, err := selectSource(root)
	if err != nil || len(selection.Files) != 2 {
		t.Fatalf("Docker build rules filtered upload: %v", err)
	}
}

func TestPreviewFlagsPreserveExplicitBooleanArguments(t *testing.T) {
	for _, value := range []string{"true", "false"} {
		command := parse([]string{"status", "--json", value, "demo"})
		if command.Flags["json"] != value || !reflect.DeepEqual(command.Positionals, []string{"demo"}) {
			t.Fatal(command)
		}
		command = parse([]string{"deploy", "--dry-run", value, "."})
		if command.Flags["dry-run"] != value || !reflect.DeepEqual(command.Positionals, []string{"."}) {
			t.Fatal(command)
		}
	}
	if err := run(parse([]string{"deploy", "--dry-run=invalid"})); err == nil {
		t.Fatal("invalid dry-run flag accepted")
	}
}

func TestDeployUploadsSelectedFilesOnly(t *testing.T) {
	root := sourceFixture(t, map[string]string{"app.js": "app", ".paastaignore": "*.log\n.env.local\n", "debug.log": "skip", ".env": "INCLUDED=value\n", ".env.local": "EXCLUDED=secret\n"})
	inspected := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/cli/context" {
			io.WriteString(w, `{"plans":[{"id":"plan"}],"clusters":[{"id":"region"}]}`)
			return
		}
		if r.URL.Path != "/api/projects/inspect" {
			t.Errorf("unexpected request %s", r.URL.Path)
			http.Error(w, "unexpected", 500)
			return
		}
		inspected = true
		if err := r.ParseMultipartForm(1024 * 1024); err != nil {
			t.Error(err)
			return
		}
		defer r.MultipartForm.RemoveAll()
		var env map[string]string
		if err := json.Unmarshal([]byte(r.FormValue("environment")), &env); err != nil {
			t.Error(err)
		}
		if len(env) != 1 || env["INCLUDED"] != "value" {
			t.Error("ignored environment was uploaded")
		}
		for _, files := range r.MultipartForm.File {
			for _, file := range files {
				stream, err := file.Open()
				if err != nil {
					t.Error(err)
					continue
				}
				body, _ := io.ReadAll(stream)
				stream.Close()
				archive, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
				if err != nil {
					t.Error(err)
					continue
				}
				paths := []string{}
				for _, entry := range archive.File {
					paths = append(paths, entry.Name)
				}
				if !reflect.DeepEqual(paths, []string{".paastaignore", "app.js"}) {
					t.Errorf("uploaded: %v", paths)
				}
			}
		}
		http.Error(w, `{"error":"acceptance stops before deployment"}`, 400)
	}))
	defer server.Close()
	err := deploy(parse([]string{"deploy", root, "--name", "fixture", "--yes"}), config{Server: server.URL, Token: "synthetic"})
	if err == nil || !inspected {
		t.Fatalf("inspect expected before stopping: %v", err)
	}
}
