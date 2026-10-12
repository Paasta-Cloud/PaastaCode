package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestArchiveExcludesSecretsAndDependencies(t *testing.T) {
	root := t.TempDir()
	_ = os.Mkdir(filepath.Join(root, "src"), 0755)
	_ = os.Mkdir(filepath.Join(root, "node_modules"), 0755)
	_ = os.WriteFile(filepath.Join(root, "src", "main.js"), []byte("ok"), 0644)
	_ = os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0644)
	_ = os.WriteFile(filepath.Join(root, "node_modules", "big.js"), []byte("skip"), 0644)
	body, files, _, err := makeArchive(root)
	if err != nil {
		t.Fatal(err)
	}
	if files != 1 {
		t.Fatalf("expected 1 file, got %d", files)
	}
	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) != 1 || reader.File[0].Name != "src/main.js" {
		t.Fatalf("unexpected archive: %#v", reader.File)
	}
}

func TestCollectEnvironmentFromComposeServiceDirectory(t *testing.T) {
	root := t.TempDir()
	backend := filepath.Join(root, "noobin-backend")
	if err := os.Mkdir(backend, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("SHARED=root\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backend, ".env"), []byte("export API_URL='https://api.example.com'\nSHARED=backend\n"), 0600); err != nil {
		t.Fatal(err)
	}

	environment, files, err := collectEnvironment(root)
	if err != nil {
		t.Fatal(err)
	}
	if files != 2 || environment["API_URL"] != "https://api.example.com" || environment["SHARED"] != "backend" {
		t.Fatalf("unexpected environment: files=%d values=%#v", files, environment)
	}
}

func TestArguments(t *testing.T) {
	parsed := parse([]string{"deploy", ".", "-n", "demo", "--billing=payg", "-y"})
	if parsed.Command != "deploy" || parsed.Flags["name"] != "demo" || parsed.Flags["billing"] != "payg" || parsed.Flags["yes"] != "true" {
		t.Fatalf("unexpected args: %#v", parsed)
	}
}

func TestExecArgumentsAfterDelimiterStayPositional(t *testing.T) {
	parsed := parse([]string{"exec", "demo", "--container", "app", "--", "node", "--version"})
	if parsed.Command != "exec" || parsed.Flags["container"] != "app" || len(parsed.Positionals) != 3 || parsed.Positionals[2] != "--version" {
		t.Fatalf("unexpected exec args: %#v", parsed)
	}
}

func TestExecCommandUsesScopedAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != "POST" || request.URL.Path != "/api/projects/demo/exec" || request.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.String())
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		command, _ := body["command"].([]any)
		if len(command) != 2 || command[0] != "node" || command[1] != "--version" || body["container"] != "app" {
			t.Fatalf("unexpected exec payload: %#v", body)
		}
		_, _ = writer.Write([]byte(`{"stdout":"v26\n","stderr":"","exitCode":0,"pod":"demo-1","container":"app"}`))
	}))
	defer server.Close()
	command := parse([]string{"exec", "demo", "--container", "app", "--", "node", "--version"})
	if err := execCommand(command, config{Server: server.URL, Token: "test-token"}); err != nil {
		t.Fatal(err)
	}
}

func TestAPIWithTransientRetryRecoversStatusPolling(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		if request.Method != http.MethodGet || request.URL.Path != "/api/projects/deploy/build-1" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if attempts < 3 {
			writer.WriteHeader(http.StatusBadGateway)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"build-1","status":"ready"}`))
	}))
	defer server.Close()

	originalSleep := apiRetrySleep
	apiRetrySleep = func(time.Duration) {}
	defer func() { apiRetrySleep = originalSleep }()

	var state buildState
	err := apiWithTransientRetry(http.MethodGet, "/api/projects/deploy/build-1", nil, &state, config{Server: server.URL, Token: "token"}, 5)
	if err != nil {
		t.Fatalf("transient status polling should recover: %v", err)
	}
	if attempts != 3 || state.Status != "ready" {
		t.Fatalf("unexpected retry result: attempts=%d state=%+v", attempts, state)
	}
}

func TestAPIWithTransientRetryDoesNotReplayMutation(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attempts++
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	err := apiWithTransientRetry(http.MethodPost, "/api/projects/deploy", map[string]string{"name": "demo"}, nil, config{Server: server.URL}, 5)
	if err == nil || attempts != 1 {
		t.Fatalf("mutating request must not be replayed: attempts=%d err=%v", attempts, err)
	}
}

func TestAPIKeyArgument(t *testing.T) {
	parsed := parse([]string{"login", "--api-key", "paasta_example", "--server=https://console.paasta.cloud"})
	if parsed.Flags["api-key"] != "paasta_example" || parsed.Flags["server"] != "https://console.paasta.cloud" {
		t.Fatalf("unexpected login args: %#v", parsed)
	}
}

func TestAgentSetupPreservesExistingConfiguration(t *testing.T) {
	root := t.TempDir()
	jsonPath := filepath.Join(root, ".mcp.json")
	if err := os.WriteFile(jsonPath, []byte(`{"mcpServers":{"other":{"command":"other"}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONMCP(jsonPath); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte(`"other"`)) || !bytes.Contains(body, []byte(`"paasta"`)) || !bytes.Contains(body, []byte(`"mcp"`)) {
		t.Fatalf("agent setup did not preserve and add servers: %s", body)
	}
	tomlPath := filepath.Join(root, ".codex", "config.toml")
	if err = os.MkdirAll(filepath.Dir(tomlPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(tomlPath, []byte("model = \"gpt\"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = writeCodexMCP(tomlPath); err != nil {
		t.Fatal(err)
	}
	if err = writeCodexMCP(tomlPath); err != nil {
		t.Fatal(err)
	}
	toml, err := os.ReadFile(tomlPath)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Count(toml, []byte(agentBlockStart)) != 1 || !bytes.Contains(toml, []byte("model = \"gpt\"")) {
		t.Fatalf("Codex setup is not idempotent: %s", toml)
	}
}

func TestLocalDeployRequiresExplicitConfirmation(t *testing.T) {
	response := localDeploy(map[string]any{"jsonrpc": "2.0", "id": float64(1), "params": map[string]any{"arguments": map[string]any{"directory": "."}}})
	result := response["result"].(map[string]any)
	if result["isError"] != true {
		t.Fatal("deploy_source must reject calls without explicit confirmation")
	}
}

func TestWindowsUpdateRetriesUntilExecutableCanBeReplaced(t *testing.T) {
	script := windowsUpdateScript(`C:\\Program Files\\Paasta\\new.exe`, `C:\\Program Files\\Paasta\\paasta.exe`, `C:\\Program Files\\Paasta\\update.cmd`)
	for _, expected := range []string{"move /Y", ":retry", "GEQ 60", ".update-error.txt", `del "C:\\Program Files\\Paasta\\update.cmd"`} {
		if !strings.Contains(script, expected) {
			t.Fatalf("Windows update helper is missing %q: %s", expected, script)
		}
	}
}

func TestAPIKeyFlagNeedsValue(t *testing.T) {
	t.Setenv("PAASTA_API_KEY", "")
	if err := login(defaultServer, "true"); err == nil {
		t.Fatal("expected missing API key error")
	}
}

func TestSafeVolumePath(t *testing.T) {
	valid, err := safeVolumePath("/data/my file.txt", false)
	if err != nil || valid != "/data/my file.txt" {
		t.Fatalf("unexpected valid path: %q %v", valid, err)
	}
	for _, candidate := range []string{"relative", "/data/../secret", "/data\\secret", "/"} {
		if _, err := safeVolumePath(candidate, false); err == nil {
			t.Fatalf("expected unsafe path to fail: %q", candidate)
		}
	}
}

func TestVolumeFileUploadUsesTusChunks(t *testing.T) {
	content := bytes.Repeat([]byte("a"), tusChunkBytes+17)
	local := filepath.Join(t.TempDir(), "upload.txt")
	if err := os.WriteFile(local, content, 0600); err != nil {
		t.Fatal(err)
	}
	offset := int64(0)
	patches := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer test-token" || request.Header.Get("Tus-Resumable") != "1.0.0" {
			t.Errorf("unexpected request headers")
		}
		switch request.Method {
		case "POST":
			if request.URL.Path != "/api/volumes/vol-1/files/tus/docs/upload.txt" || request.Header.Get("Upload-Length") != strconv.Itoa(len(content)) {
				t.Errorf("unexpected creation: %s", request.URL.String())
			}
			response.Header().Set("Location", "/upload/one")
			response.WriteHeader(http.StatusCreated)
		case "HEAD":
			response.Header().Set("Upload-Offset", strconv.FormatInt(offset, 10))
			response.WriteHeader(http.StatusNoContent)
		case "PATCH":
			body, _ := io.ReadAll(request.Body)
			if len(body) > tusChunkBytes || !bytes.Equal(body, content[offset:offset+int64(len(body))]) {
				t.Errorf("unexpected upload chunk at %d", offset)
			}
			patches++
			offset += int64(len(body))
			response.Header().Set("Upload-Offset", strconv.FormatInt(offset, 10))
			response.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected request method: %s", request.Method)
		}
	}))
	defer server.Close()
	if err := uploadVolumeFile("vol-1", local, "/docs/upload.txt", false, config{Server: server.URL, Token: "test-token"}); err != nil {
		t.Fatal(err)
	}
	if patches != 2 || offset != int64(len(content)) {
		t.Fatalf("unexpected tus progress: patches=%d offset=%d", patches, offset)
	}
}

func TestVolumeFileOperationIsIdempotentAndPathSafe(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == "GET" {
			if request.URL.Query().Get("operation") != "volume-file-op-test" {
				t.Fatalf("unexpected status query")
			}
			_, _ = response.Write([]byte(`{"status":"succeeded"}`))
			return
		}
		var payload map[string]string
		_ = json.NewDecoder(request.Body).Decode(&payload)
		if request.Method != "POST" || payload["action"] != "copy" || payload["path"] != "/from" || payload["destination"] != "/to" || !strings.HasPrefix(payload["operationKey"], "cli-") {
			t.Fatalf("unexpected operation: %#v", payload)
		}
		_, _ = response.Write([]byte(`{"ok":true,"operationId":"volume-file-op-test"}`))
	}))
	defer server.Close()
	if err := volumeOperation("vol-1", "copy", "/from", "/to", config{Server: server.URL, Token: "token"}); err != nil {
		t.Fatal(err)
	}
	if err := volumeOperation("vol-1", "copy", "/../from", "/to", config{Server: server.URL, Token: "token"}); err == nil {
		t.Fatal("unsafe source accepted")
	}
}

func TestVolumeFileDownloadIsAtomic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("download") != "1" || request.URL.Query().Get("path") != "/docs/report.txt" {
			t.Errorf("unexpected download query: %s", request.URL.RawQuery)
		}
		_, _ = response.Write([]byte("downloaded"))
	}))
	defer server.Close()
	output := filepath.Join(t.TempDir(), "report.txt")
	path := volumeFilesPath("vol-1", "/docs/report.txt", url.Values{"download": []string{"1"}})
	if err := downloadToFile(path, output, false, config{Server: server.URL, Token: "test-token"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(output)
	if err != nil || string(data) != "downloaded" {
		t.Fatalf("unexpected downloaded file: %q %v", data, err)
	}
}

func TestVersionComparison(t *testing.T) {
	if !newerVersion("0.3.1", "0.4.0") || newerVersion("0.4.0", "0.4.0") || newerVersion("1.0.0", "0.9.9") {
		t.Fatal("semantic version comparison failed")
	}
}

func TestComposeVolumesUseSafeNonInteractiveDefaults(t *testing.T) {
	compose := &composeInspection{Volumes: []string{"uploads", "database"}, Services: []composeService{{Name: "web", Volumes: []composeMount{{Source: "uploads", Target: "/app/uploads"}, {Source: "database", Target: "/var/lib/data"}}}}}
	offerings := []storageOffering{{ID: "ssd", Cluster: "region-1", Name: "SSD", MinSize: 5, MaxSize: 100}}
	requests, err := composeVolumeRequests(compose, offerings, "region-1", "payg", map[string]string{}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 || requests[0].MountPath != "/app/uploads" || requests[0].SizeGB != 5 || requests[1].Name != "database" {
		t.Fatalf("unexpected requests: %#v", requests)
	}
}

func TestDownloadBackupStreamsAndAuthenticates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/backups/backup-1" || request.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("unexpected request: %s %s", request.URL.Path, request.Header.Get("Authorization"))
		}
		_, _ = writer.Write([]byte("backup bytes"))
	}))
	defer server.Close()
	output := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := downloadBackup("backup-1", output, false, config{Server: server.URL, Token: "token"}); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(output)
	if err != nil || string(body) != "backup bytes" {
		t.Fatalf("unexpected download: %q, %v", body, err)
	}
}

func TestDownloadBackupProtectsExistingFile(t *testing.T) {
	output := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := os.WriteFile(output, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	err := downloadBackup("backup-1", output, false, config{Server: "http://127.0.0.1"})
	if err == nil {
		t.Fatal("expected overwrite protection")
	}
	body, _ := os.ReadFile(output)
	if string(body) != "keep" {
		t.Fatalf("existing file changed: %q", body)
	}
}

func TestDownloadBackupRemovesPartialFileOnHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"error":"backup not found"}`))
	}))
	defer server.Close()
	output := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := downloadBackup("missing", output, false, config{Server: server.URL}); err == nil {
		t.Fatal("expected download error")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("partial file remains: %v", err)
	}
}

func TestDownloadBackupKeepsExistingFileWhenOverwriteDownloadFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()
	output := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := os.WriteFile(output, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := downloadBackup("backup-1", output, true, config{Server: server.URL}); err == nil {
		t.Fatal("expected download error")
	}
	body, _ := os.ReadFile(output)
	if string(body) != "original" {
		t.Fatalf("existing file changed after failed download: %q", body)
	}
}

func TestDatabaseLifecycleCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, path string
		command            args
		body               string
	}{
		{"list", "GET", "/api/databases/db-1/backups", parse([]string{"database", "backups", "db-1", "--json"}), ""},
		{"verify", "POST", "/api/databases/db-1/backups/backup-1/verify", parse([]string{"database", "backup", "verify", "db-1", "backup-1"}), ""},
		{"restore", "POST", "/api/databases/db-1/backups/backup-1/restore", parse([]string{"database", "backup", "restore", "db-1", "backup-1", "--yes"}), ""},
		{"delete", "DELETE", "/api/databases/db-1/backups/backup-1", parse([]string{"database", "backup", "delete", "db-1", "backup-1", "--yes"}), ""},
		{"policy", "PATCH", "/api/databases/db-1", parse([]string{"database", "policy", "db-1", "--schedule", "daily", "--retention", "7"}), `"action":"backup-policy"`},
		{"pitr", "PATCH", "/api/databases/db-1", parse([]string{"database", "pitr", "enable", "db-1", "--yes"}), `"enabled":true`},
		{"recovery", "POST", "/api/databases/db-1/recovery", parse([]string{"database", "recover", "db-1", "--at", "2026-08-01T10:30:00+03:30", "--yes"}), `"target_at":"2026-08-01T10:30:00+03:30"`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != test.method || request.URL.Path != test.path {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				writer.Header().Set("Content-Type", "application/json")
				if test.name == "list" {
					_, _ = writer.Write([]byte(`{"backups":[]}`))
				} else {
					_, _ = writer.Write([]byte(`{"ok":true}`))
				}
			}))
			defer server.Close()
			if err := databaseCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDatabaseRecoveryRequiresExplicitConfirmationAndValidTime(t *testing.T) {
	for _, command := range []args{
		parse([]string{"database", "recover", "db-1", "--at", "2026-08-01T10:30:00+03:30"}),
		parse([]string{"database", "recover", "db-1", "--at", "invalid", "--yes"}),
		parse([]string{"database", "backup", "restore", "db-1", "backup-1"}),
		parse([]string{"database", "pitr", "disable", "db-1"}),
	} {
		if err := databaseCommand(command, config{}); err == nil {
			t.Fatal("expected safety validation error")
		}
	}
}

func TestDatabaseAccessCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, body string
		command            args
	}{
		{"list", "GET", "", parse([]string{"database", "access", "db-1", "--json"})},
		{"create", "POST", `"action":"create"`, parse([]string{"database", "credential", "create", "db-1", "--database", "reports", "--username", "reporter", "--yes"})},
		{"reveal", "POST", `"action":"reveal"`, parse([]string{"database", "credential", "reveal", "db-1", "credential-1", "--show-secret"})},
		{"rotate", "POST", `"action":"rotate"`, parse([]string{"database", "credential", "rotate", "db-1", "credential-1", "--yes"})},
		{"connect", "POST", `"action":"connect"`, parse([]string{"database", "connection", "create", "db-1", "credential-1", "--project", "project-1", "--key", "REPORTS_URL", "--yes"})},
		{"disconnect", "DELETE", `"connection_id":"connection-1"`, parse([]string{"database", "connection", "delete", "db-1", "connection-1", "--yes"})},
		{"delete", "DELETE", `"credential_id":"credential-1"`, parse([]string{"database", "credential", "delete", "db-1", "credential-1", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != test.method || request.URL.Path != "/api/databases/db-1/access" {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				writer.Header().Set("Content-Type", "application/json")
				if test.name == "list" {
					_, _ = writer.Write([]byte(`{"engine":"postgres","credentials":[],"projects":[]}`))
				} else {
					_, _ = writer.Write([]byte(`{"ok":true,"credentialId":"credential-1","connectionId":"connection-1","environmentKey":"REPORTS_URL","connection":{"password":"secret","url":"postgres://secret"}}`))
				}
			}))
			defer server.Close()
			if err := databaseCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDatabaseCredentialSecretAndMutationGuards(t *testing.T) {
	for _, command := range []args{
		parse([]string{"database", "credential", "create", "db-1", "--database", "reports", "--username", "reporter"}),
		parse([]string{"database", "credential", "reveal", "db-1", "credential-1"}),
		parse([]string{"database", "credential", "rotate", "db-1", "credential-1"}),
		parse([]string{"database", "credential", "delete", "db-1", "credential-1"}),
		parse([]string{"database", "connection", "create", "db-1", "credential-1", "--project", "project-1"}),
		parse([]string{"database", "connection", "delete", "db-1", "connection-1"}),
	} {
		if err := databaseCommand(command, config{}); err == nil {
			t.Fatalf("expected guard for %#v", command)
		}
	}
}

func TestDatabaseCredentialMutationHidesSecretsByDefault(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = writer
	printErr := printCredentialMutation(databaseCredentialMutation{
		OK:           true,
		CredentialID: "credential-1",
		Connection:   map[string]any{"password": "must-not-print", "url": "postgres://must-not-print"},
	}, false)
	_ = writer.Close()
	os.Stdout = original
	output, readErr := io.ReadAll(reader)
	_ = reader.Close()
	if printErr != nil || readErr != nil {
		t.Fatalf("capture failed: %v %v", printErr, readErr)
	}
	if strings.Contains(string(output), "must-not-print") || !strings.Contains(string(output), "credential-1") {
		t.Fatalf("unsafe credential output: %s", output)
	}
}

func TestNotificationCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, path, body string
		command                  args
	}{
		{"preference", "PATCH", "/api/notifications/preferences", `"kind":"uptime"`, parse([]string{"notification", "preference", "set", "uptime", "--email", "false", "--sms", "false", "--yes"})},
		{"create", "POST", "/api/notifications", `"destination":"ops@example.com"`, parse([]string{"notification", "channel", "create", "--name", "operations", "--kind", "email", "--destination", "ops@example.com", "--yes"})},
		{"disable", "PATCH", "/api/notifications/channel-1", `"enabled":false`, parse([]string{"notification", "channel", "disable", "channel-1", "--yes"})},
		{"test", "POST", "/api/notifications/channel-1", "", parse([]string{"notification", "channel", "test", "channel-1", "--yes"})},
		{"delete", "DELETE", "/api/notifications/channel-1", "", parse([]string{"notification", "channel", "delete", "channel-1", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != test.method || request.URL.Path != test.path {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{"ok":true}`))
			}))
			defer server.Close()
			if err := notificationCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestNotificationMutationAndWebhookSecretGuards(t *testing.T) {
	for _, command := range []args{
		parse([]string{"notification", "preference", "set", "uptime", "--email", "true"}),
		parse([]string{"notification", "channel", "delete", "channel-1"}),
		parse([]string{"notification", "channel", "create", "--name", "hook", "--kind", "webhook", "--url", "https://example.com/hook", "--yes"}),
	} {
		if err := notificationCommand(command, config{}); err == nil {
			t.Fatalf("expected guard for %#v", command)
		}
	}
	secretPath := filepath.Join(t.TempDir(), "webhook-secret")
	if err := os.WriteFile(secretPath, []byte("0123456789abcdef\n"), 0600); err != nil {
		t.Fatal(err)
	}
	secret, err := webhookSecret(secretPath)
	if err != nil || secret != "0123456789abcdef" {
		t.Fatalf("unexpected secret file result: %q %v", secret, err)
	}
	if err := os.Chmod(secretPath, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := webhookSecret(secretPath); runtime.GOOS != "windows" && err == nil {
		t.Fatal("expected open secret file permissions to fail")
	}
}

func TestSupportCommandRoutingAndPrivateFileInputs(t *testing.T) {
	directory := t.TempDir()
	bodyPath := filepath.Join(directory, "message.txt")
	attachmentPath := filepath.Join(directory, "error.log")
	if err := os.WriteFile(bodyPath, []byte("private diagnostic context"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(attachmentPath, []byte("bounded log"), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch request.Method + " " + request.URL.Path {
		case "GET /api/support":
			_, _ = writer.Write([]byte(`{"tickets":[]}`))
		case "GET /api/support/ticket-1":
			_, _ = writer.Write([]byte(`{"ticket":{"id":"ticket-1","number":"42","subject":"Deploy failed","status":"open","priority":"normal"},"messages":[]}`))
		case "PATCH /api/support/ticket-1":
			data, _ := io.ReadAll(request.Body)
			if !strings.Contains(string(data), `"status":"closed"`) {
				t.Fatalf("unexpected close body: %s", data)
			}
			_, _ = writer.Write([]byte(`{"ok":true}`))
		case "POST /api/support", "POST /api/support/ticket-1":
			if err := request.ParseMultipartForm(maxSupportAttachmentBytes + 1024); err != nil {
				t.Fatal(err)
			}
			if request.FormValue("body") != "private diagnostic context" {
				t.Fatalf("private body was not read from file: %q", request.FormValue("body"))
			}
			if request.URL.Path == "/api/support" && request.FormValue("subject") != "Deploy failed" {
				t.Fatalf("unexpected subject: %q", request.FormValue("subject"))
			}
			file, header, err := request.FormFile("attachment")
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			content, _ := io.ReadAll(file)
			if header.Header.Get("Content-Type") != "text/plain" || string(content) != "bounded log" {
				t.Fatalf("unexpected attachment: %s %q", header.Header.Get("Content-Type"), content)
			}
			_, _ = writer.Write([]byte(`{"ok":true,"id":"ticket-1"}`))
		default:
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	commands := []args{
		parse([]string{"support", "tickets", "--json"}),
		parse([]string{"support", "ticket", "ticket-1", "--json"}),
		parse([]string{"support", "create", "--subject", "Deploy failed", "--body-file", bodyPath, "--attachment", attachmentPath, "--yes"}),
		parse([]string{"support", "reply", "ticket-1", "--body-file", bodyPath, "--attachment", attachmentPath, "--yes"}),
		parse([]string{"support", "close", "ticket-1", "--yes"}),
	}
	for _, command := range commands {
		if err := supportCommand(command, cfg); err != nil {
			t.Fatalf("support command failed for %#v: %v", command, err)
		}
	}
}

func TestSupportMutationsAndFileBoundsRequireExplicitSafety(t *testing.T) {
	bodyPath := filepath.Join(t.TempDir(), "message.txt")
	if err := os.WriteFile(bodyPath, []byte("enough context"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, command := range []args{
		parse([]string{"support", "create", "--subject", "Deploy failed", "--body-file", bodyPath}),
		parse([]string{"support", "reply", "ticket-1", "--body-file", bodyPath}),
		parse([]string{"support", "close", "ticket-1"}),
	} {
		if err := supportCommand(command, config{}); err == nil {
			t.Fatalf("expected --yes guard for %#v", command)
		}
	}
	oversized := filepath.Join(t.TempDir(), "large.zip")
	file, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err = file.Truncate(maxSupportAttachmentBytes + 1); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	if _, _, _, err = readSupportAttachment(oversized); err == nil {
		t.Fatal("expected oversized support attachment to fail")
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write(make([]byte, maxSupportAttachmentBytes+1))
	}))
	defer server.Close()
	output := filepath.Join(t.TempDir(), "attachment.zip")
	if err = downloadToFileLimited("/attachment", output, false, maxSupportAttachmentBytes, config{Server: server.URL, Token: "token"}); err == nil {
		t.Fatal("expected oversized support download to fail")
	}
	if _, statErr := os.Stat(output); !os.IsNotExist(statErr) {
		t.Fatalf("oversized download left an output file: %v", statErr)
	}
}

func TestCdnCommandRoutesTenantOperationsAndFileInputs(t *testing.T) {
	directory := t.TempDir()
	recordsFile := filepath.Join(directory, "records.json")
	originFile := filepath.Join(directory, "origin.json")
	firewallFile := filepath.Join(directory, "firewall.json")
	if err := os.WriteFile(recordsFile, []byte(`[{"name":"www","type":"CNAME","value":"example.com","ttl":300,"cdn":true}]`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(originFile, []byte(`{"name":"quickcdn-www","scheme":"https","hostHeader":"www.example.com","servers":[{"host":"203.0.113.10","port":443,"weight":1}],"healthProtocol":"tcp","healthPath":"/","haRouting":false,"smartRouting":false}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(firewallFile, []byte(`{"name":"block-admin","enabled":true,"constraintGroups":[[{"type":"path","operator":"starts_with","expected":["/admin"],"negate":false}]],"action":{"type":"block","statusCode":403}}`), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		body, _ := io.ReadAll(request.Body)
		switch request.Method + " " + request.URL.Path {
		case "GET /api/cdn/sites":
			_, _ = writer.Write([]byte(`{"sites":[{"id":"site-1","domain":"example.com","status":"active","plan_id":"starter","plan_name":"Starter","monthly_price_toman":"10000"}],"plans":[{"id":"starter","name":"Starter","monthly_price_toman":"10000","traffic_gb":10},{"id":"pro","name":"Pro","monthly_price_toman":"30000","traffic_gb":50}],"nameservers":["ns.example"]}`))
		case "POST /api/cdn/sites":
			if !strings.Contains(string(body), `"domain":"example.com"`) || !strings.Contains(string(body), `"records":[{"cdn":true`) {
				t.Fatalf("unexpected create body: %s", body)
			}
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"ok":true,"id":"site-1"}`))
		case "GET /api/cdn/sites/site-1", "GET /api/cdn/sites/site-1/records", "GET /api/cdn/sites/site-1/origin", "GET /api/cdn/sites/site-1/firewall":
			_, _ = writer.Write([]byte(`{"ok":true,"records":[],"upstreams":[],"rules":[]}`))
		case "POST /api/cdn/scan":
			_, _ = writer.Write([]byte(`{"domain":"example.com","records":[]}`))
		case "POST /api/cdn/sites/site-1/records":
			if !strings.Contains(string(body), `"type":"A"`) || !strings.Contains(string(body), `"ttl":300`) {
				t.Fatalf("unexpected DNS body: %s", body)
			}
			_, _ = writer.Write([]byte(`{"ok":true,"records":[]}`))
		case "PATCH /api/cdn/sites/site-1/origin":
			if !strings.Contains(string(body), `"hostHeader":"www.example.com"`) {
				t.Fatalf("origin file was not sent: %s", body)
			}
			_, _ = writer.Write([]byte(`{"ok":true,"upstreams":[]}`))
		case "POST /api/cdn/sites/site-1/actions":
			if !strings.Contains(string(body), `"action"`) {
				t.Fatalf("unexpected action body: %s", body)
			}
			_, _ = writer.Write([]byte(`{"ok":true}`))
		case "POST /api/cdn/sites/site-1/firewall":
			if !strings.Contains(string(body), `"name":"block-admin"`) {
				t.Fatalf("firewall file was not sent: %s", body)
			}
			_, _ = writer.Write([]byte(`{"rules":[]}`))
		case "PUT /api/cdn/sites/site-1/plan":
			if !strings.Contains(string(body), `"planId":"pro"`) {
				t.Fatalf("unexpected plan body: %s", body)
			}
			_, _ = writer.Write([]byte(`{"chargedToman":20000}`))
		case "DELETE /api/cdn/sites/site-1":
			if request.URL.Query().Get("immediate") != "1" {
				t.Fatal("immediate deletion query is required")
			}
			_, _ = writer.Write([]byte(`{"ok":true,"immediate":true}`))
		default:
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.String())
		}
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	commands := []args{
		parse([]string{"cdn", "sites", "--json"}),
		parse([]string{"cdn", "plans", "--json"}),
		parse([]string{"cdn", "site", "site-1", "--json"}),
		parse([]string{"cdn", "scan", "example.com", "--json"}),
		parse([]string{"cdn", "create", "example.com", "--origin", "203.0.113.10", "--plan", "starter", "--records-file", recordsFile, "--yes", "--json"}),
		parse([]string{"cdn", "record", "add", "site-1", "--name", "@", "--type", "A", "--value", "203.0.113.10", "--cdn", "true", "--yes", "--json"}),
		parse([]string{"cdn", "origin", "set", "site-1", "--file", originFile, "--yes", "--json"}),
		parse([]string{"cdn", "purge", "site-1", "--paths", "/,/assets/*", "--yes", "--json"}),
		parse([]string{"cdn", "feature", "site-1", "--name", "tls", "--enabled", "true", "--yes", "--json"}),
		parse([]string{"cdn", "firewall", "add", "site-1", "--file", firewallFile, "--yes", "--json"}),
		parse([]string{"cdn", "plan", "site-1", "--plan", "pro", "--yes", "--json"}),
		parse([]string{"cdn", "delete", "site-1", "--yes", "--json"}),
	}
	for _, command := range commands {
		if err := cdnCommand(command, cfg); err != nil {
			t.Fatalf("CDN command failed for %#v: %v", command, err)
		}
	}
}

func TestCdnMutationsRequireConfirmationAndBoundedRegularJSON(t *testing.T) {
	for _, command := range []args{
		parse([]string{"cdn", "cancel", "site-1"}),
		parse([]string{"cdn", "renew", "site-1"}),
		parse([]string{"cdn", "delete", "site-1"}),
		parse([]string{"cdn", "record", "delete", "site-1", "--id", "www:0"}),
		parse([]string{"cdn", "origin", "set", "site-1", "--file", "missing.json"}),
		parse([]string{"cdn", "purge", "site-1", "--paths", "/"}),
		parse([]string{"cdn", "feature", "site-1", "--name", "tls", "--enabled", "true"}),
		parse([]string{"cdn", "firewall", "delete", "site-1", "--id", "0"}),
	} {
		if err := cdnCommand(command, config{}); err == nil {
			t.Fatalf("expected --yes guard for %#v", command)
		}
	}
	oversized := filepath.Join(t.TempDir(), "large.json")
	file, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err = file.Truncate(128*1024 + 1); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	var value map[string]any
	if err = readJSONFile(oversized, &value); err == nil {
		t.Fatal("expected oversized JSON input to fail")
	}
}

func TestCdnFinancialMutationsShowCostBeforeConfirmation(t *testing.T) {
	mutated := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.Method == "GET" && request.URL.Path == "/api/cdn/sites" {
			_, _ = writer.Write([]byte(`{"sites":[{"id":"site-1","plan_id":"starter","monthly_price_toman":"10000"}],"plans":[{"id":"starter","monthly_price_toman":"10000","traffic_gb":10},{"id":"pro","monthly_price_toman":"30000","traffic_gb":50}]}`))
			return
		}
		mutated = true
	}))
	defer server.Close()
	cfg := config{Server: server.URL}
	for _, command := range []args{
		parse([]string{"cdn", "create", "example.com", "--origin", "203.0.113.10", "--plan", "starter"}),
		parse([]string{"cdn", "plan", "site-1", "--plan", "pro"}),
	} {
		if err := cdnCommand(command, cfg); err == nil || mutated {
			t.Fatalf("expected cost review before mutation for %#v", command)
		}
	}
}

func TestDeploymentAndPreviewCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, path, body string
		command                  args
	}{
		{"deployments", "GET", "/api/projects/demo/deployments", "", parse([]string{"deployments", "demo", "--json"})},
		{"status", "GET", "/api/projects/deploy/build-1", "", parse([]string{"deployment", "status", "build-1"})},
		{"logs", "GET", "/api/projects/deploy/build-1/logs", "", parse([]string{"deployment", "logs", "build-1"})},
		{"retry", "POST", "/api/projects/deploy/build-1/retry", "", parse([]string{"deployment", "retry", "build-1", "--yes", "--json"})},
		{"rollback", "POST", "/api/projects/demo/rollback", `"buildId":"build-1"`, parse([]string{"deployment", "rollback", "demo", "--build", "build-1", "--yes"})},
		{"previews", "GET", "/api/projects/demo/previews", "", parse([]string{"previews", "demo", "--json"})},
		{"preview-create", "POST", "/api/projects/demo/previews", `"lifetimeHours":24`, parse([]string{"preview", "create", "demo", "staging", "--hours", "24", "--build", "build-1", "--yes"})},
		{"preview-promote", "POST", "/api/projects/demo/previews/preview-1/promote", "", parse([]string{"preview", "promote", "demo", "preview-1", "--yes"})},
		{"preview-delete", "DELETE", "/api/projects/demo/previews/preview-1", "", parse([]string{"preview", "delete", "demo", "preview-1", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != test.method || request.URL.Path != test.path {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				writer.Header().Set("Content-Type", "application/json")
				switch test.name {
				case "deployments":
					_, _ = writer.Write([]byte(`{"deployments":[]}`))
				case "previews":
					_, _ = writer.Write([]byte(`{"previews":[]}`))
				case "logs":
					_, _ = writer.Write([]byte("build output"))
				case "retry":
					_, _ = writer.Write([]byte(`{"id":"build-2","project":"demo","status":"queued","retryStage":"build"}`))
				default:
					_, _ = writer.Write([]byte(`{"ok":true}`))
				}
			}))
			defer server.Close()
			cfg := config{Server: server.URL, Token: "token"}
			var err error
			switch test.command.Command {
			case "deployments":
				err = deployments(test.command.Positionals[0], cfg, true)
			case "deployment":
				err = deploymentCommand(test.command, cfg)
			case "previews":
				err = previews(test.command.Positionals[0], cfg, true)
			case "preview":
				err = previewCommand(test.command, cfg)
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDeploymentAndPreviewMutationsRequireExplicitConfirmation(t *testing.T) {
	for _, command := range []args{
		parse([]string{"deployment", "retry", "build-1"}),
		parse([]string{"deployment", "rollback", "demo", "--build", "build-1"}),
		parse([]string{"deployment", "rollback", "demo", "--yes"}),
		parse([]string{"preview", "create", "demo", "staging", "--hours", "24"}),
		parse([]string{"preview", "create", "demo", "staging", "--hours", "169", "--yes"}),
		parse([]string{"preview", "promote", "demo", "preview-1"}),
		parse([]string{"preview", "delete", "demo", "preview-1"}),
	} {
		var err error
		if command.Command == "deployment" {
			err = deploymentCommand(command, config{})
		} else {
			err = previewCommand(command, config{})
		}
		if err == nil {
			t.Fatal("expected safety validation error")
		}
	}
}

func TestProcessLifecycleCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, path, body string
		command                  args
	}{
		{"list", "GET", "/api/projects/demo/processes", "", parse([]string{"processes", "demo", "--json"})},
		{"create", "POST", "/api/projects/demo/processes", `"type":"worker"`, parse([]string{"process", "create", "demo", "--type", "worker", "--name", "queue", "--command", "npm run worker", "--plan", "basic", "--billing", "payg", "--replicas", "2", "--yes"})},
		{"update", "PUT", "/api/projects/demo/processes/process-1", `"schedule":"0 * * * *"`, parse([]string{"process", "update", "demo", "process-1", "--status", "active", "--schedule", "0 * * * *", "--yes"})},
		{"start", "PUT", "/api/projects/demo/processes/process-1", `"status":"active"`, parse([]string{"process", "start", "demo", "process-1", "--yes"})},
		{"stop", "PUT", "/api/projects/demo/processes/process-1", `"status":"paused"`, parse([]string{"process", "stop", "demo", "process-1", "--yes"})},
		{"run", "POST", "/api/projects/demo/processes/process-1/run", "", parse([]string{"process", "run", "demo", "process-1", "--yes"})},
		{"logs", "GET", "/api/projects/demo/processes/process-1/logs", "", parse([]string{"process", "logs", "demo", "process-1", "--json"})},
		{"delete", "DELETE", "/api/projects/demo/processes/process-1", "", parse([]string{"process", "delete", "demo", "process-1", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				if test.name == "create" && request.URL.Path == "/api/cli/context" {
					_, _ = writer.Write([]byte(`{"plans":[{"id":"basic","name":"Basic","monthly_price_toman":"10000","hourly_price_toman":"20"}]}`))
					return
				}
				if (test.name == "start" || test.name == "run") && request.Method == "GET" && request.URL.Path == "/api/projects/demo/processes" {
					_, _ = writer.Write([]byte(`{"processes":[{"id":"process-1","billing_mode":"payg","hourly_price_toman":"20","desired_replicas":1}]}`))
					return
				}
				if request.Method != test.method || request.URL.Path != test.path {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				switch test.name {
				case "list":
					_, _ = writer.Write([]byte(`{"processes":[]}`))
				case "logs":
					_, _ = writer.Write([]byte(`{"logs":"done\n","phase":"Succeeded"}`))
				case "run":
					_, _ = writer.Write([]byte(`{"ok":true,"executionId":"execution-1"}`))
				default:
					_, _ = writer.Write([]byte(`{"ok":true,"id":"process-1"}`))
				}
			}))
			defer server.Close()
			cfg := config{Server: server.URL, Token: "token"}
			var err error
			if test.command.Command == "processes" {
				err = processes(test.command.Positionals[0], cfg, true)
			} else {
				err = processCommandCLI(test.command, cfg)
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProcessMutationsValidateInputAndConfirmation(t *testing.T) {
	for _, command := range []args{
		parse([]string{"process", "create", "demo", "--type", "invalid", "--name", "queue", "--command", "work", "--plan", "basic", "--billing", "payg", "--yes"}),
		parse([]string{"process", "create", "demo", "--type", "cron", "--name", "hourly", "--command", "work", "--plan", "basic", "--billing", "payg", "--schedule", "@daily", "--yes"}),
		parse([]string{"process", "start", "demo", "process-1"}),
		parse([]string{"process", "stop", "demo", "process-1"}),
		parse([]string{"process", "run", "demo", "process-1"}),
		parse([]string{"process", "delete", "demo", "process-1"}),
		parse([]string{"process", "update", "demo", "process-1", "--status", "broken", "--yes"}),
	} {
		if err := processCommandCLI(command, config{}); err == nil {
			t.Fatal("expected process safety validation error")
		}
	}
}

func TestProcessCreateShowsCostBeforeConfirmation(t *testing.T) {
	posted := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.URL.Path == "/api/cli/context" {
			_, _ = writer.Write([]byte(`{"plans":[{"id":"basic","name":"Basic","monthly_price_toman":"10000","hourly_price_toman":"20"}]}`))
			return
		}
		posted = true
	}))
	defer server.Close()
	command := parse([]string{"process", "create", "demo", "--type", "worker", "--name", "queue", "--command", "work", "--plan", "basic", "--billing", "monthly"})
	if err := processCommandCLI(command, config{Server: server.URL}); err == nil || posted {
		t.Fatal("expected confirmation before process creation")
	}
}

func TestAvailabilityCommandRoutingAndCost(t *testing.T) {
	tests := []struct {
		name, method, body string
		command            args
	}{
		{"status", "", "", parse([]string{"availability", "demo", "--json"})},
		{"set", "PUT", `"autoscaling":true`, parse([]string{"availability", "set", "demo", "--autoscaling", "true", "--min", "2", "--max", "3", "--cpu", "65", "--ha", "true", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mutated := false
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				if request.Method == "GET" && request.URL.Path == "/api/projects/demo/availability" {
					_, _ = writer.Write([]byte(`{"autoscaling":false,"highAvailability":false,"minReplicas":1,"maxReplicas":3,"cpuTarget":70,"desiredReplicas":1,"stack":"node","billingMode":"payg","planName":"Basic","monthlyPriceToman":"10000","hourlyPriceToman":"20","hasRwoVolume":false}`))
					return
				}
				mutated = true
				if request.Method != test.method || request.URL.Path != "/api/projects/demo/availability" {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				_, _ = writer.Write([]byte(`{"ok":true,"autoscaling":true,"highAvailability":true,"minReplicas":2,"maxReplicas":3,"cpuTarget":65,"desiredReplicas":2,"chargedToman":0}`))
			}))
			defer server.Close()
			if err := availabilityCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
			if mutated != (test.method != "") {
				t.Fatalf("unexpected mutation state: %t", mutated)
			}
		})
	}
}

func TestAvailabilityRequiresConfirmationAndRejectsUnsafeSettings(t *testing.T) {
	tests := []args{
		parse([]string{"availability", "set", "demo", "--autoscaling", "true", "--min", "1", "--max", "3", "--ha", "true", "--yes"}),
		parse([]string{"availability", "set", "demo", "--autoscaling", "true", "--min", "1", "--max", "4", "--yes"}),
		parse([]string{"availability", "set", "demo", "--cpu", "95", "--yes"}),
		parse([]string{"availability", "set", "demo", "--autoscaling", "true"}),
	}
	for index, command := range tests {
		t.Run(strconv.Itoa(index), func(t *testing.T) {
			mutated := false
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				if request.Method == "GET" {
					_, _ = writer.Write([]byte(`{"autoscaling":false,"highAvailability":false,"minReplicas":1,"maxReplicas":3,"cpuTarget":70,"desiredReplicas":1,"stack":"node","billingMode":"monthly","monthlyPriceToman":"10000","hourlyPriceToman":"20","hasRwoVolume":false}`))
					return
				}
				mutated = true
			}))
			defer server.Close()
			if err := availabilityCommand(command, config{Server: server.URL}); err == nil || mutated {
				t.Fatal("expected availability safety validation before mutation")
			}
		})
	}
}

func TestResourceAlertCommandRouting(t *testing.T) {
	tests := []struct {
		name, method, body string
		command            args
	}{
		{"list", "GET", "", parse([]string{"alerts", "demo", "--json"})},
		{"set", "POST", `"metric":"cpu"`, parse([]string{"alert", "set", "demo", "--service", "web", "--metric", "cpu", "--threshold", "80", "--duration", "10", "--severity", "critical", "--yes"})},
		{"delete", "DELETE", `"id":"rule-1"`, parse([]string{"alert", "delete", "demo", "--id", "rule-1", "--yes"})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				if request.Method != test.method || request.URL.Path != "/api/projects/demo/resource-alerts" {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if test.body != "" && !strings.Contains(string(body), test.body) {
					t.Fatalf("unexpected body: %s", body)
				}
				if test.name == "list" {
					_, _ = writer.Write([]byte(`{"rules":[{"id":"rule-1","service_name":"web","metric":"cpu","threshold_percent":80,"duration_minutes":10,"severity":"critical","enabled":true}]}`))
				} else {
					_, _ = writer.Write([]byte(`{"ok":true,"id":"rule-1"}`))
				}
			}))
			defer server.Close()
			if err := resourceAlertsCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestResourceAlertMutationsRequireConfirmationAndValidBounds(t *testing.T) {
	for _, command := range []args{
		parse([]string{"alert", "set", "demo", "--metric", "disk", "--threshold", "80", "--duration", "10", "--yes"}),
		parse([]string{"alert", "set", "demo", "--metric", "cpu", "--threshold", "101", "--duration", "10", "--yes"}),
		parse([]string{"alert", "set", "demo", "--metric", "memory", "--threshold", "80", "--duration", "20", "--yes"}),
		parse([]string{"alert", "set", "demo", "--metric", "cpu", "--threshold", "80", "--duration", "10"}),
		parse([]string{"alert", "delete", "demo", "--id", "rule-1"}),
	} {
		if err := resourceAlertsCommand(command, config{}); err == nil {
			t.Fatal("expected resource alert safety validation error")
		}
	}
}

func TestMonitorCommandRouting(t *testing.T) {
	for _, test := range []struct {
		name, method, body string
		command            args
	}{
		{"status", "", "", parse([]string{"monitor", "demo", "--json"})},
		{"set", "PATCH", `"failureThreshold":5`, parse([]string{"monitor", "set", "demo", "--enabled", "true", "--path", "/health", "--failures", "5", "--yes"})},
	} {
		t.Run(test.name, func(t *testing.T) {
			mutated := false
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				if request.Method == "GET" {
					_, _ = writer.Write([]byte(`{"enabled":true,"path":"/","failureThreshold":3,"consecutiveFailures":0,"lastStatus":200,"lastLatencyMs":42,"availability24h":100,"checks":[]}`))
					return
				}
				mutated = true
				if request.Method != test.method || request.URL.Path != "/api/projects/demo/monitor" {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				body, _ := io.ReadAll(request.Body)
				if !strings.Contains(string(body), test.body) || !strings.Contains(string(body), `"path":"/health"`) {
					t.Fatalf("unexpected body: %s", body)
				}
				_, _ = writer.Write([]byte(`{"ok":true,"enabled":true,"path":"/health","failureThreshold":5}`))
			}))
			defer server.Close()
			if err := monitorCommand(test.command, config{Server: server.URL, Token: "token"}); err != nil {
				t.Fatal(err)
			}
			if mutated != (test.method != "") {
				t.Fatalf("unexpected mutation state: %t", mutated)
			}
		})
	}
}

func TestMonitorCommandRejectsUnsafeSettingsBeforeMutation(t *testing.T) {
	for _, command := range []args{
		parse([]string{"monitor", "set", "demo", "--path", "//other-host", "--yes"}),
		parse([]string{"monitor", "set", "demo", "--failures", "4", "--yes"}),
		parse([]string{"monitor", "set", "demo", "--enabled", "false"}),
	} {
		mutated := false
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			if request.Method == "GET" {
				_, _ = writer.Write([]byte(`{"enabled":true,"path":"/","failureThreshold":3}`))
				return
			}
			mutated = true
		}))
		if err := monitorCommand(command, config{Server: server.URL}); err == nil || mutated {
			server.Close()
			t.Fatal("expected monitor safety validation before mutation")
		}
		server.Close()
	}
}

func TestGitOperationsCommandRouting(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests = append(requests, request.Method+" "+request.URL.RequestURI())
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/api/integrations/git/connections":
			_, _ = writer.Write([]byte(`{"connections":[{"id":"connection","provider":"github","username":"acme"}]}`))
		case "/api/integrations/git/repositories":
			if request.URL.Query().Get("repository") != "" {
				_, _ = writer.Write([]byte(`{"branches":["main","release/v1"]}`))
				return
			}
			_, _ = writer.Write([]byte(`{"repositories":[{"name":"acme/app","url":"https://github.com/acme/app","private":true,"defaultBranch":"main"}]}`))
		case "/api/projects/demo/git":
			if request.Method == "POST" {
				body, _ := io.ReadAll(request.Body)
				if !strings.Contains(string(body), `"action":"toggle"`) || !strings.Contains(string(body), `"enabled":true`) {
					t.Fatalf("unexpected Git mutation: %s", body)
				}
				_, _ = writer.Write([]byte(`{"enabled":true,"managed":true}`))
				return
			}
			_, _ = writer.Write([]byte(`{"project":"demo","repository":"https://github.com/acme/app","ref":"main","root":"","autoDeploy":false,"webhookConfigured":true,"managedWebhook":true,"connectedAccount":true}`))
		default:
			t.Fatalf("unexpected request: %s", request.URL.Path)
		}
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	commands := [][]string{
		{"git", "connections", "--json"},
		{"git", "repositories", "connection", "--json"},
		{"git", "branches", "connection", "https://github.com/acme/app", "--json"},
		{"git", "demo", "--json"},
		{"git", "auto-deploy", "demo", "--enabled", "true", "--yes"},
	}
	for _, values := range commands {
		if err := gitOperationsCommand(parse(values), cfg); err != nil {
			t.Fatalf("%v: %v", values, err)
		}
	}
	if len(requests) != len(commands) {
		t.Fatalf("expected %d requests, got %d", len(commands), len(requests))
	}
}

func TestGitOperationsRejectsMutationWithoutConfirmation(t *testing.T) {
	mutated := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) { mutated = true }))
	defer server.Close()
	for _, values := range [][]string{
		{"git", "auto-deploy", "demo", "--enabled", "true"},
		{"git", "auto-deploy", "demo", "--enabled", "maybe", "--yes"},
	} {
		if err := gitOperationsCommand(parse(values), config{Server: server.URL}); err == nil || mutated {
			t.Fatalf("expected validation before mutation for %v", values)
		}
	}
}

func TestTeamCommandRouting(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		requests = append(requests, request.Method+" "+request.URL.Path+" "+string(body))
		writer.Header().Set("Content-Type", "application/json")
		if request.Method == "GET" {
			_, _ = writer.Write([]byte(`{"members":[{"id":"user-1","name":"Owner","email":"owner@example.com","role":"owner","project_ids":[]}],"invitations":[],"projects":[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"demo"}]}`))
			return
		}
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	commands := [][]string{
		{"team", "--json"},
		{"team", "invite", "member@example.com", "--role", "developer", "--projects", "123e4567-e89b-12d3-a456-426614174000", "--yes"},
		{"team", "member", "update", "user-1", "--role", "viewer", "--yes"},
		{"team", "member", "remove", "user-1", "--yes"},
		{"team", "invitation", "cancel", "invite-1", "--yes"},
	}
	for _, values := range commands {
		if err := teamCommand(parse(values), cfg); err != nil {
			t.Fatalf("%v: %v", values, err)
		}
	}
	if len(requests) != len(commands) || !strings.Contains(requests[1], `"projectIds":["123e4567-e89b-12d3-a456-426614174000"]`) || !strings.HasPrefix(requests[2], "PATCH ") || !strings.HasPrefix(requests[3], "DELETE ") || !strings.Contains(requests[4], `"invitationId":"invite-1"`) {
		t.Fatalf("unexpected team requests: %v", requests)
	}
}

func TestTeamCommandRejectsUnsafeMutationBeforeRequest(t *testing.T) {
	mutated := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) { mutated = true }))
	defer server.Close()
	for _, values := range [][]string{
		{"team", "invite", "member@example.com", "--role", "developer"},
		{"team", "invite", "bad", "--role", "developer", "--yes"},
		{"team", "invite", "member@example.com", "--role", "owner", "--yes"},
		{"team", "member", "update", "user-1", "--role", "viewer", "--projects", "not-a-uuid", "--yes"},
		{"team", "member", "remove", "user-1"},
	} {
		if err := teamCommand(parse(values), config{Server: server.URL}); err == nil || mutated {
			t.Fatalf("expected validation before mutation for %v", values)
		}
	}
}

func TestManagedDomainCommandRoutingAndIdempotency(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		requests = append(requests, request.Method+" "+request.URL.RequestURI()+" "+string(body))
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case request.URL.Path == "/api/domain-registration/domains":
			_, _ = writer.Write([]byte(`{"domains":[{"id":"domain-1","fqdn":"example.com","tld":"com","status":"active","expires_at":null,"auto_renew":true,"nameservers":[]}]}`))
		case request.URL.Path == "/api/domain-registration/search":
			_, _ = writer.Write([]byte(`{"domain":"example.com","tld":"com","provider":"joker","operation":"register","years":1,"available":true,"premium":false,"privacy":false,"priceToman":250000,"prices":{"1":250000}}`))
		case request.URL.Path == "/api/domain-registration/orders":
			_, _ = writer.Write([]byte(`{"ok":true,"orderId":"order-1","domainId":"domain-1","status":"completed"}`))
		default:
			_, _ = writer.Write([]byte(`{"ok":true}`))
		}
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	key := "123e4567-e89b-42d3-a456-426614174000"
	commands := [][]string{
		{"domains", "--json"},
		{"domain", "quote", "example.com", "--years", "1"},
		{"domain", "register", "example.com", "--years", "1", "--operation-key", key, "--yes", "--json"},
		{"domain", "renew", "domain-1", "--years", "2", "--operation-key", key, "--yes"},
		{"domain", "nameservers", "domain-1", "--set", "ns1.example.com,ns2.example.com", "--yes"},
		{"domain", "auto-renew", "domain-1", "--enabled", "false", "--yes"},
		{"domain", "transfer-lock", "domain-1", "--locked", "true", "--yes"},
		{"domain", "retry-order", "domain-1", "--order", "order-1", "--yes"},
	}
	for _, values := range commands {
		parsed := parse(values)
		if values[0] == "domains" {
			parsed.Positionals = nil
		}
		if err := managedDomainCommand(parsed, cfg); err != nil {
			t.Fatalf("%v: %v", values, err)
		}
	}
	joined := strings.Join(requests, "\n")
	if !strings.Contains(joined, `"idempotencyKey":"`+key+`"`) || !strings.Contains(joined, `"action":"nameservers"`) || !strings.Contains(joined, `"action":"retry-order"`) {
		t.Fatalf("unexpected domain requests: %s", joined)
	}
}

func TestManagedDomainCommandProtectsOrdersAndSecrets(t *testing.T) {
	mutations := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		if request.Method != "GET" {
			mutations++
		}
		_, _ = writer.Write([]byte(`{"domain":"example.com","tld":"com","provider":"joker","operation":"register","years":1,"available":true,"priceToman":250000}`))
	}))
	defer server.Close()
	cfg := config{Server: server.URL, Token: "token"}
	for _, values := range [][]string{
		{"domain", "register", "example.com"},
		{"domain", "register", "example.com", "--operation-key", "bad", "--yes"},
		{"domain", "transfer-code", "domain-1", "--yes"},
		{"domain", "nameservers", "domain-1", "--set", "one.example.com", "--yes"},
	} {
		if err := managedDomainCommand(parse(values), cfg); err == nil || mutations != 0 {
			t.Fatalf("expected safe rejection for %v", values)
		}
	}
}

func TestProjectStartStopTransport(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("config-directory override is covered on Linux and Windows")
	}
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	for _, test := range []struct {
		command  string
		replicas int
		status   int
	}{{"start", 1, 200}, {"stop", 0, 200}, {"start", 1, 400}} {
		t.Run(test.command+strconv.Itoa(test.status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "PUT" || r.URL.Path != "/api/projects/uptime-kuma-demo/scale" {
					t.Errorf("unexpected lifecycle route: %s %s", r.Method, r.URL.Path)
				}
				var body struct {
					Replicas int `json:"replicas"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Replicas != test.replicas {
					t.Errorf("unexpected replicas: %d, %v", body.Replicas, err)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(test.status)
				if test.status == 200 {
					_, _ = w.Write([]byte(`{"ok":true,"status":"deploying"}`))
				} else {
					_, _ = w.Write([]byte(`{"error":"file manager still holds disk"}`))
				}
			}))
			defer server.Close()
			if err := saveConfig(config{Server: server.URL, Token: "test-token"}); err != nil {
				t.Fatal(err)
			}
			err := run(parse([]string{test.command, "uptime-kuma-demo"}))
			if test.status == 200 && err != nil {
				t.Fatal(err)
			}
			if test.status == 400 && (err == nil || !strings.Contains(err.Error(), "file manager still holds disk")) {
				t.Fatalf("API error must reach CLI: %v", err)
			}
			if calls != 1 {
				t.Fatalf("unexpected lifecycle retries: %d", calls)
			}
		})
	}
}
