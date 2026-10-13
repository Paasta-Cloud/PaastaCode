package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func exportTestRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestWorkspaceExportPreservesProjectAndExcludesLinks(t *testing.T) {
	root := exportTestRoot(t)
	files := map[string]string{"src/سلام.txt": "سلام", ".env": "SYNTHETIC=yes", ".git/config": "[core]\n", ".gitignore": "ignored.txt\n", "ignored.txt": "kept", "empty.txt": "", "nested/.paastacode/account.json": "synthetic-private", ".ssh/key": "synthetic-key", ".paasta/config.json": "synthetic-token"}
	for name, value := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(root, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside-canary"), 0600); err != nil {
		t.Fatal(err)
	}
	linked := os.Symlink(outside, filepath.Join(root, "outside-link")) == nil
	if !linked && runtime.GOOS != "windows" {
		t.Fatal("symlink fixture unavailable")
	}
	var output bytes.Buffer
	if err := exportWorkspace(root, &output); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, file := range archive.File {
		if strings.Contains(file.Name, ".paasta") || strings.Contains(file.Name, ".ssh") || strings.Contains(file.Name, "outside-link") {
			t.Fatalf("private entry exported: %s", file.Name)
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		seen[file.Name] = string(content)
	}
	for _, name := range []string{"src/سلام.txt", ".env", ".git/config", ".gitignore", "ignored.txt", "empty.txt"} {
		if value, ok := seen[name]; !ok || value != files[name] {
			t.Fatalf("project file was not preserved: %s", name)
		}
	}
	if _, ok := seen["empty/"]; !ok {
		t.Fatal("empty directory lost")
	}
	for name, value := range files {
		actual, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		if err != nil || string(actual) != value {
			t.Fatal("export modified a source file")
		}
	}
}

type failingExportWriter struct{}

func (failingExportWriter) Write([]byte) (int, error) {
	return 0, errors.New("synthetic interrupted download")
}

func TestWorkspaceExportInterruptedAndInvalidInput(t *testing.T) {
	root := exportTestRoot(t)
	if err := os.WriteFile(filepath.Join(root, "project.txt"), []byte("project"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := exportWorkspace(root, failingExportWriter{}); err == nil {
		t.Fatal("failed destination accepted")
	}
	if err := exportWorkspace(filepath.Join(root, "missing"), io.Discard); err == nil {
		t.Fatal("missing workspace accepted")
	}
	for _, input := range []args{{}, {Positionals: []string{root, root}}, {Positionals: []string{root}, Flags: map[string]string{"token": "synthetic"}}} {
		if err := workspaceExport(input); err == nil {
			t.Fatal("invalid export command accepted")
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.WriteFile(filepath.Join(root, `..\escape`), []byte("unsafe zip path"), 0600); err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if err := exportWorkspace(root, &output); err == nil {
			t.Fatal("Windows traversal name accepted")
		}
		if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err == nil {
			t.Fatal("failed archive was marked complete")
		}
	}
}

func TestWorkspaceExportCustomAccountBoundary(t *testing.T) {
	root := exportTestRoot(t)
	private := filepath.Join(root, "custom-account")
	if err := os.Mkdir(private, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(private, "credentials.json"), []byte("synthetic-private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "custom-account-project.txt"), []byte("project"), 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := exportWorkspace(root, &output, private); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 || archive.File[0].Name != "custom-account-project.txt" {
		t.Fatal("custom credential boundary failed")
	}
	if err := exportWorkspace(root, io.Discard, root); err == nil {
		t.Fatal("account root accepted")
	}
}

type changingExportWriter struct {
	bytes.Buffer
	change func()
}

func (writer *changingExportWriter) Write(data []byte) (int, error) {
	if writer.change != nil {
		change := writer.change
		writer.change = nil
		change()
	}
	return writer.Buffer.Write(data)
}

func TestWorkspaceExportRejectsFileGrowthDuringRead(t *testing.T) {
	root := exportTestRoot(t)
	path := filepath.Join(root, "changing.bin")
	data := make([]byte, 2*1024*1024)
	if _, err := rand.Read(data); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	output := &changingExportWriter{change: func() {
		file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		if _, err = file.Write([]byte("changed")); err != nil {
			t.Fatal(err)
		}
	}}
	if err := exportWorkspace(root, output); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatalf("changed file was accepted: %v", err)
	}
	if _, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len())); err == nil {
		t.Fatal("inconsistent archive was completed")
	}
}
