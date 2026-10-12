package main

import "testing"

func TestScopedRuntimeCredentialsDoNotRequireOrOverwriteSavedLogin(t *testing.T) {
	t.Setenv("PAASTA_RUNTIME_TOKEN", "synthetic-runtime-token")
	t.Setenv("PAASTA_RUNTIME_SERVER", "https://console.paasta.cloud")
	cfg, err := loadConfig()
	if err != nil || cfg.Token != "synthetic-runtime-token" || cfg.Server != defaultServer {
		t.Fatal("in-memory scoped credentials were not loaded")
	}
	for _, server := range []string{"http://external.example", "https://user:password@example.test", "https://example.test/path", "https://example.test?token=value", "https://example.test#fragment", "file://localhost/"} {
		t.Setenv("PAASTA_RUNTIME_SERVER", server)
		if _, err := loadConfig(); err == nil {
			t.Fatal("unsafe runtime origin accepted")
		}
	}
	t.Setenv("PAASTA_RUNTIME_SERVER", "http://127.0.0.1:3000")
	if _, err := loadConfig(); err != nil {
		t.Fatal("loopback test origin rejected")
	}
	t.Setenv("PAASTA_RUNTIME_TOKEN", "synthetic\nheader")
	if _, err := loadConfig(); err == nil {
		t.Fatal("header injection accepted")
	}
}
