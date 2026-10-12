package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const agentBlockStart = "# BEGIN PAASTA MCP"
const agentBlockEnd = "# END PAASTA MCP"

var localDeployTool = map[string]any{
	"name":        "paasta.deploy_source",
	"title":       "Deploy local source to Paasta",
	"description": "Package a local project directory and deploy it to Paasta. This may create billable resources. Inspect the project first and obtain explicit user approval before setting confirm to true.",
	"inputSchema": map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"directory": map[string]any{"type": "string", "default": ".", "description": "Local project directory, usually the current working directory."},
			"name":      map[string]any{"type": "string", "pattern": "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", "description": "Optional Paasta project slug."},
			"billing":   map[string]any{"type": "string", "enum": []string{"payg", "monthly"}, "default": "payg"},
			"confirm":   map[string]any{"type": "boolean", "description": "Must be true after the user approves deployment and its possible cost."},
		},
		"required": []string{"confirm"},
	},
	"annotations": map[string]any{"readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false},
}

func writeJSONMCP(path string) error {
	value := map[string]any{}
	if body, err := os.ReadFile(path); err == nil && len(bytes.TrimSpace(body)) > 0 {
		if err = json.Unmarshal(body, &value); err != nil {
			return fmt.Errorf("cannot update %s: invalid JSON", path)
		}
	}
	servers, _ := value["mcpServers"].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
		value["mcpServers"] = servers
	}
	servers["paasta"] = map[string]any{"command": "paasta", "args": []string{"mcp"}}
	body, _ := json.MarshalIndent(value, "", "  ")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0644)
}

func writeCodexMCP(path string) error {
	body, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	text := string(body)
	block := agentBlockStart + "\n[mcp_servers.paasta]\ncommand = \"paasta\"\nargs = [\"mcp\"]\n" + agentBlockEnd
	if start := strings.Index(text, agentBlockStart); start >= 0 {
		if end := strings.Index(text[start:], agentBlockEnd); end >= 0 {
			text = text[:start] + block + text[start+end+len(agentBlockEnd):]
		}
	} else {
		text = strings.TrimRight(text, "\r\n") + "\n\n" + block + "\n"
	}
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(text), 0644)
}

func installAgentSkill(root string) error {
	content := `---
name: use-paasta
description: Deploy and operate the current project on Paasta through its MCP tools and CLI.
---

# Use Paasta

Inspect the current project before deployment. Use read-only Paasta tools to identify existing projects and recent failures. For local source, explain the detected stack and ask the user to approve deployment and possible cost before calling paasta.deploy_source with confirm=true. Never print or request the saved Paasta token. After deployment, inspect deployment state and logs until the service is ready or return an actionable error. Ask for explicit confirmation before deletion, rollback, suspension, or any operation that may remove data.
`
	for _, relative := range []string{filepath.Join(".agents", "skills", "use-paasta", "SKILL.md"), filepath.Join(".claude", "skills", "use-paasta", "SKILL.md")} {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return err
		}
	}
	return nil
}

func setupAgent(command args) error {
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	target := value(command.Flags, "agent", "all")
	if target == "print" {
		fmt.Println(`{"mcpServers":{"paasta":{"command":"paasta","args":["mcp"]}}}`)
		return nil
	}
	valid := map[string]bool{"all": true, "claude-code": true, "codex": true, "cursor": true}
	if !valid[target] {
		return errors.New("--agent must be claude-code, codex, cursor, print, or omitted")
	}
	if target == "all" || target == "claude-code" {
		if err = writeJSONMCP(filepath.Join(root, ".mcp.json")); err != nil {
			return err
		}
	}
	if target == "all" || target == "cursor" {
		if err = writeJSONMCP(filepath.Join(root, ".cursor", "mcp.json")); err != nil {
			return err
		}
	}
	if target == "all" || target == "codex" {
		if err = writeCodexMCP(filepath.Join(root, ".codex", "config.toml")); err != nil {
			return err
		}
	}
	if command.Flags["no-skill"] != "true" {
		if err = installAgentSkill(root); err != nil {
			return err
		}
	}
	success("Paasta is connected. Reload your agent, then ask it to deploy this project.")
	return nil
}

func rpcResult(id any, value any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": value}
}

func localDeploy(request map[string]any) map[string]any {
	id := request["id"]
	params, _ := request["params"].(map[string]any)
	arguments, _ := params["arguments"].(map[string]any)
	if arguments["confirm"] != true {
		return rpcResult(id, map[string]any{"content": []map[string]any{{"type": "text", "text": "Deployment requires explicit user approval. Set confirm to true only after explaining that this may create billable resources."}}, "isError": true})
	}
	directory := "."
	if raw, ok := arguments["directory"].(string); ok && strings.TrimSpace(raw) != "" {
		directory = raw
	}
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return rpcResult(id, map[string]any{"content": []map[string]any{{"type": "text", "text": "The source directory does not exist or is not a directory."}}, "isError": true})
	}
	executable, err := os.Executable()
	if err != nil {
		return rpcResult(id, map[string]any{"content": []map[string]any{{"type": "text", "text": err.Error()}}, "isError": true})
	}
	values := []string{"deploy", directory, "--yes", "--json"}
	if name, ok := arguments["name"].(string); ok && name != "" {
		values = append(values, "--name", name)
	}
	if billing, ok := arguments["billing"].(string); ok && billing != "" {
		values = append(values, "--billing", billing)
	}
	child := exec.Command(executable, values...)
	child.Env = append(os.Environ(), "NO_COLOR=1")
	output, runErr := child.CombinedOutput()
	text := strings.TrimSpace(string(output))
	if text == "" && runErr != nil {
		text = runErr.Error()
	}
	return rpcResult(id, map[string]any{"content": []map[string]any{{"type": "text", "text": text}}, "isError": runErr != nil})
}

func forwardMCP(raw []byte, cfg config) ([]byte, int, error) {
	req, err := http.NewRequest("POST", endpoint(cfg.Server, "/api/mcp"), bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("MCP-Protocol-Version", "2025-11-25")
	req.Header.Set("User-Agent", "paasta-cli/"+version)
	response, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024))
	return body, response.StatusCode, err
}

func runMCP(cfg config) error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		raw := bytes.TrimSpace(scanner.Bytes())
		if len(raw) == 0 {
			continue
		}
		var request map[string]any
		if json.Unmarshal(raw, &request) != nil {
			continue
		}
		params, _ := request["params"].(map[string]any)
		if request["method"] == "tools/call" && params["name"] == "paasta.deploy_source" {
			if err := encoder.Encode(localDeploy(request)); err != nil {
				return err
			}
			continue
		}
		body, status, err := forwardMCP(raw, cfg)
		if err != nil {
			return err
		}
		if status == http.StatusAccepted || len(bytes.TrimSpace(body)) == 0 {
			continue
		}
		var response map[string]any
		if err = json.Unmarshal(body, &response); err != nil {
			return fmt.Errorf("Paasta MCP returned HTTP %d", status)
		}
		if request["method"] == "tools/list" {
			if result, ok := response["result"].(map[string]any); ok {
				if tools, ok := result["tools"].([]any); ok {
					result["tools"] = append(tools, localDeployTool)
				}
			}
		}
		if err = encoder.Encode(response); err != nil {
			return err
		}
	}
	return scanner.Err()
}
