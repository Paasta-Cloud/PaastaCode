package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type sourceFile struct {
	Path  string `json:"path"`
	Bytes int64  `json:"bytes"`
	info  os.FileInfo
}

type sourceSelection struct {
	Files            []sourceFile `json:"files"`
	Bytes            int64        `json:"bytes"`
	IgnoreFiles      []string     `json:"ignoreFiles"`
	EnvironmentFiles []string     `json:"environmentFiles"`
	ArchiveSHA256    string       `json:"archiveSha256,omitempty"`
	root             string
}

// Select once for both the archive and environment import. Dry-run uses the same
// selection without reading file contents, credentials, or contacting the API.
func selectSource(directory string) (*sourceSelection, error) {
	root, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, errors.New("project path is not a directory")
	}
	selection := &sourceSelection{root: root, Files: []sourceFile{}, IgnoreFiles: []string{}, EnvironmentFiles: []string{}}
	rules, paastaIgnore, err := readSourceIgnore(root, ".paastaignore")
	if err != nil {
		return nil, err
	}
	if paastaIgnore {
		selection.IgnoreFiles = append(selection.IgnoreFiles, ".paastaignore")
	}
	scopes := map[string][]sourceIgnoreRule{}
	err = filepath.WalkDir(root, func(filename string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, filename)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		parentRules := rules
		if filename != root {
			parentRules = scopes[filepath.Dir(filename)]
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			if (entry.IsDir() && skipped[entry.Name()]) || sourceIgnored(relative, entry.IsDir(), parentRules) {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}
		if entry.IsDir() {
			if !paastaIgnore {
				ignorePath := filepath.ToSlash(filepath.Join(relative, ".gitignore"))
				extra, exists, err := readSourceIgnore(root, ignorePath)
				if err != nil {
					return err
				}
				if exists {
					selection.IgnoreFiles = append(selection.IgnoreFiles, ignorePath)
					parentRules = append(append([]sourceIgnoreRule{}, parentRules...), extra...)
				}
			}
			scopes[filename] = parentRules
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if environmentFile(entry.Name()) {
			selection.EnvironmentFiles = append(selection.EnvironmentFiles, relative)
			return nil
		}
		if sensitive(entry.Name()) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		selection.Files = append(selection.Files, sourceFile{Path: relative, Bytes: info.Size(), info: info})
		selection.Bytes += info.Size()
		if len(selection.Files) > 5000 {
			return errors.New("project has more than 5000 files; exclude unnecessary files in .paastaignore")
		}
		if selection.Bytes > maxProjectSourceBytes {
			return errors.New("project source is larger than 100 MB; exclude generated files in .paastaignore")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return selection, nil
}

func (selection *sourceSelection) collectEnvironment() (map[string]string, int, error) {
	paths := append([]string{}, selection.EnvironmentFiles...)
	sort.Slice(paths, func(i, j int) bool {
		a, b := strings.Count(paths[i], "/"), strings.Count(paths[j], "/")
		if a != b {
			return a < b
		}
		return paths[i] < paths[j]
	})
	result := map[string]string{}
	for _, relative := range paths {
		content, err := os.ReadFile(filepath.Join(selection.root, filepath.FromSlash(relative)))
		if err != nil {
			return nil, 0, err
		}
		for key, value := range parseEnvironment(string(content)) {
			result[key] = value
		}
	}
	return result, len(paths), nil
}

func collectEnvironment(directory string) (map[string]string, int, error) {
	selection, err := selectSource(directory)
	if err != nil {
		return nil, 0, err
	}
	return selection.collectEnvironment()
}

func (selection *sourceSelection) archive() ([]byte, int, int64, error) {
	if len(selection.Files) == 0 {
		return nil, 0, 0, errors.New("project directory has no source files after exclusions")
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, file := range selection.Files {
		header, err := zip.FileInfoHeader(file.info)
		if err != nil {
			return nil, 0, 0, err
		}
		header.Name, header.Method = file.Path, zip.Deflate
		target, err := writer.CreateHeader(header)
		if err != nil {
			return nil, 0, 0, err
		}
		source, err := os.Open(filepath.Join(selection.root, filepath.FromSlash(file.Path)))
		if err != nil {
			return nil, 0, 0, err
		}
		// Bound reads if a file grows after selection; never silently truncate it.
		copied, copyErr := io.Copy(target, io.LimitReader(source, file.Bytes+1))
		closeErr := source.Close()
		if copyErr != nil {
			return nil, 0, 0, copyErr
		}
		if closeErr != nil {
			return nil, 0, 0, closeErr
		}
		if copied != file.Bytes {
			return nil, 0, 0, fmt.Errorf("source file changed while packing: %s; run deploy again", file.Path)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, 0, 0, err
	}
	return buffer.Bytes(), len(selection.Files), selection.Bytes, nil
}

func makeArchive(directory string) ([]byte, int, int64, error) {
	selection, err := selectSource(directory)
	if err != nil {
		return nil, 0, 0, err
	}
	return selection.archive()
}

func previewSource(command args) error {
	if command.Flags["git"] != "" || command.Flags["image"] != "" {
		return errors.New("--dry-run previews a local source directory; omit --git and --image")
	}
	if len(command.Positionals) > 1 {
		return errors.New("use: paasta deploy [PATH] --dry-run [--json]")
	}
	directory := "."
	if len(command.Positionals) == 1 {
		directory = command.Positionals[0]
	}
	selection, err := selectSource(directory)
	if err != nil {
		return err
	}
	if command.Flags["json"] == "true" {
		if command.Flags["hash"] == "true" {
			archive, _, _, err := selection.archive()
			if err != nil {
				return err
			}
			selection.ArchiveSHA256 = fmt.Sprintf("%x", sha256.Sum256(archive))
		}
		return printJSON(selection)
	}
	fmt.Println("Local preview only. No files uploaded or services changed.")
	if len(selection.IgnoreFiles) > 0 {
		fmt.Println("Ignore rules: " + strings.Join(selection.IgnoreFiles, ", "))
	} else {
		fmt.Println("Ignore rules: built-in exclusions only")
	}
	fmt.Printf("Source archive: %d files, %d bytes (%.2f MiB before compression)\n", len(selection.Files), selection.Bytes, float64(selection.Bytes)/1024/1024)
	for _, file := range selection.Files {
		fmt.Printf("  %q (%d bytes)\n", file.Path, file.Bytes)
	}
	fmt.Printf("Environment files imported separately: %d (values hidden)\n", len(selection.EnvironmentFiles))
	for _, file := range selection.EnvironmentFiles {
		fmt.Printf("  %q\n", file)
	}
	return nil
}
