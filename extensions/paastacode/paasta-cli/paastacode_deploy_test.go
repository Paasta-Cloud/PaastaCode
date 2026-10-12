package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPaastaCodeCredentialsCannotEnterSourceArchive(t *testing.T) {
	root := sourceFixture(t, map[string]string{"index.html": "fixture", ".paastaignore": "!*\n!**/*\n", ".paastacode/account.json": "synthetic-secret", ".ssh/id_ed25519": "synthetic-secret", ".kube/config": "synthetic-secret", "kubeconfig.yaml": "synthetic-secret", "signing.pfx": "synthetic-secret", "id_rsa": "synthetic-secret"})
	selection, err := selectSource(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range selection.Files {
		if strings.Contains(file.Path, "account.json") || strings.Contains(file.Path, "id_") || strings.Contains(file.Path, "kube") || strings.HasSuffix(file.Path, ".pfx") {
			t.Fatal("credentials were included despite built-in exclusions")
		}
	}
}

func TestPaastaCodeSourceApprovalRejectsChangedFilesBeforeUpload(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	var preview sourceSelection
	output := captureStdout(t, func() {
		if err := previewSource(parse([]string{"deploy", root, "--dry-run", "--hash", "--json"})); err != nil {
			t.Fatal(err)
		}
	})
	if err := json.Unmarshal([]byte(output), &preview); err != nil || len(preview.ArchiveSHA256) != 64 {
		t.Fatal("hashed preview unavailable")
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("other"), 0600); err != nil {
		t.Fatal(err)
	}
	uploads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/api/cli/context" {
			_, _ = w.Write([]byte(`{"plans":[{"id":"test-plan"}],"clusters":[{"id":"test-region"}],"projects":[]}`))
			return
		}
		uploads++
		w.WriteHeader(500)
	}))
	defer server.Close()
	err := deploy(parse([]string{"deploy", root, "--yes", "--no-env", "--detach", "--source-sha256", preview.ArchiveSHA256}), config{Server: server.URL, Token: "synthetic"})
	if err == nil || !strings.Contains(err.Error(), "source changed after approval") || uploads != 0 {
		t.Fatal("changed source was not rejected before upload")
	}
}

func TestPaastaCodeDetachedDeploymentDoesNotImportEnvironment(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("SYNTHETIC_SECRET=never-import"), 0600); err != nil {
		t.Fatal(err)
	}
	var preview sourceSelection
	output := captureStdout(t, func() {
		if err := previewSource(parse([]string{"deploy", root, "--dry-run", "--hash", "--json"})); err != nil {
			t.Fatal(err)
		}
	})
	if err := json.Unmarshal([]byte(output), &preview); err != nil {
		t.Fatal(err)
	}
	deployments := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/cli/context":
			_, _ = w.Write([]byte(`{"plans":[{"id":"test-plan"}],"clusters":[{"id":"test-region"}],"projects":[]}`))
		case "/api/projects/inspect", "/api/projects/deploy":
			if err := r.ParseMultipartForm(1024 * 1024); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			if r.FormValue("environment") != "" {
				t.Error("environment was imported")
			}
			if r.URL.Path == "/api/projects/inspect" {
				_, _ = w.Write([]byte(`{"Stack":"static","Port":8080,"Domain":"fixture.example.test"}`))
				return
			}
			deployments++
			_, _ = w.Write([]byte(`{"ID":"synthetic-build"}`))
		default:
			t.Error("detached deployment must not poll or send extra mutations")
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	captureStdout(t, func() {
		if err := deploy(parse([]string{"deploy", root, "--yes", "--no-env", "--detach", "--source-sha256", preview.ArchiveSHA256}), config{Server: server.URL, Token: "synthetic"}); err != nil {
			t.Fatal(err)
		}
	})
	if deployments != 1 {
		t.Fatal("expected one deployment mutation")
	}
}
