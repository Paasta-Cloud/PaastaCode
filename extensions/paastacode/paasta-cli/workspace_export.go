package main

import (
	"archive/zip"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Workspace downloads preserve Git, ignored files and project environment files.
// Deployment archives deliberately have a different selection policy.
func exportWorkspace(directory string, target io.Writer, privateRoots ...string) error {
	directory, err := filepath.Abs(directory)
	if err != nil {
		return errors.New("cannot open workspace for export")
	}
	resolved, err := filepath.EvalSymlinks(directory)
	if err != nil || resolved != directory && !(runtime.GOOS == "windows" && strings.EqualFold(resolved, directory)) {
		return errors.New("workspace path changed; open its real directory again")
	}
	initial, err := os.Lstat(directory)
	if err != nil || !initial.IsDir() {
		return errors.New("cannot open workspace for export")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return errors.New("cannot open workspace for export")
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(initial, opened) {
		return errors.New("workspace path changed during export; retry")
	}
	excluded := map[string]bool{}
	for _, private := range privateRoots {
		if private == "" {
			continue
		}
		private, err = filepath.EvalSymlinks(private)
		if err != nil {
			return errors.New("cannot verify the private account directory")
		}
		private, err = filepath.Abs(private)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(directory, private)
		if err != nil {
			return errors.New("cannot verify the private account directory")
		}
		if relative == "." {
			return errors.New("the private account directory cannot be exported")
		}
		if filepath.IsLocal(relative) {
			excluded[filepath.ToSlash(relative)] = true
		}
	}
	archive := zip.NewWriter(target)
	entries := 0
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return errors.New("workspace changed or cannot be read; retry the export")
		}
		if name == "." {
			return nil
		}
		if !fs.ValidPath(name) || strings.ContainsAny(name, "\\:\x00") {
			return errors.New("workspace contains a path that cannot be safely exported")
		}
		// Omit the broker's configured store and common local account directories.
		if excluded[name] || entry.Name() == ".paastacode" || entry.Name() == ".paasta" || entry.Name() == ".ssh" {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.IsDir() && !entry.Type().IsRegular() {
			return nil
		}
		entries++
		if entries > 1_000_000 {
			return errors.New("workspace has too many entries for one export")
		}
		info, err := entry.Info()
		if err != nil {
			return errors.New("workspace changed during export; retry")
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = name
		if info.IsDir() {
			header.Name += "/"
			_, err = archive.CreateHeader(header)
			return err
		}
		// Root.Open enforces containment even if a path component becomes a symlink.
		source, err := root.Open(name)
		if err != nil {
			return errors.New("workspace file changed or cannot be read; retry")
		}
		current, err := source.Stat()
		if err != nil || !current.Mode().IsRegular() || !os.SameFile(info, current) || info.Size() != current.Size() || !info.ModTime().Equal(current.ModTime()) {
			source.Close()
			return errors.New("workspace file changed during export; retry")
		}
		header.Method = zip.Deflate
		destination, err := archive.CreateHeader(header)
		if err != nil {
			source.Close()
			return err
		}
		copied, copyErr := io.Copy(destination, io.LimitReader(source, info.Size()+1))
		after, statErr := source.Stat()
		closeErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if statErr != nil || closeErr != nil || copied != info.Size() || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
			return errors.New("workspace file changed during export; retry")
		}
		return nil
	})
	if err != nil {
		// An incomplete stream must never receive the ZIP completion record.
		return err
	}
	return archive.Close()
}

func workspaceExport(command args) error {
	if len(command.Positionals) != 1 || len(command.Flags) > 1 || len(command.Flags) == 1 && command.Flags["private-root"] == "" {
		return errors.New("use: paasta workspace-export PATH > project.zip")
	}
	return exportWorkspace(command.Positionals[0], os.Stdout, command.Flags["private-root"])
}
