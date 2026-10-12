package main

import (
	"bufio"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Rules are scoped to the directory containing the ignore file. Walking prunes
// excluded directories, so a child cannot be restored unless its parent is too.
type sourceIgnoreRule struct {
	base                            string
	parts                           []string
	negate, directoryOnly, anchored bool
}

func readSourceIgnore(root, relative string) ([]sourceIgnoreRule, bool, error) {
	filename := filepath.Join(root, filepath.FromSlash(relative))
	info, err := os.Lstat(filename)
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if !info.Mode().IsRegular() {
		return nil, false, fmt.Errorf("%s must be a regular file, not a directory or symlink", relative)
	}
	if info.Size() > 1024*1024 {
		return nil, false, fmt.Errorf("%s is larger than 1 MiB", relative)
	}
	file, err := os.Open(filename)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	base := path.Dir(relative)
	if base == "." {
		base = ""
	}
	rules := []sourceIgnoreRule{}
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if lineNumber == 1 {
			line = strings.TrimPrefix(line, "\ufeff")
		}
		// Only unescaped trailing spaces are insignificant; leading spaces are literal.
		for strings.HasSuffix(line, " ") {
			backslashes := 0
			for i := len(line) - 2; i >= 0 && line[i] == '\\'; i-- {
				backslashes++
			}
			if backslashes%2 == 1 {
				break
			}
			line = line[:len(line)-1]
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rule := sourceIgnoreRule{base: base, negate: strings.HasPrefix(line, "!")}
		if rule.negate {
			line = line[1:]
		}
		rule.directoryOnly = strings.HasSuffix(line, "/")
		line = strings.TrimSuffix(line, "/")
		rule.anchored = strings.Contains(line, "/")
		line = strings.TrimPrefix(line, "/")
		if line == "" {
			continue
		}
		rule.parts = strings.Split(line, "/")
		for i, part := range rule.parts {
			// Git uses [!a-z] for a negated class; path.Match uses [^a-z].
			var converted strings.Builder
			for j := 0; j < len(part); j++ {
				if part[j] == '\\' && j+1 < len(part) {
					converted.WriteString(part[j : j+2])
					j++
					continue
				}
				converted.WriteByte(part[j])
				if part[j] == '[' && j+1 < len(part) && part[j+1] == '!' {
					converted.WriteByte('^')
					j++
				}
			}
			rule.parts[i] = converted.String()
			if _, err := path.Match(rule.parts[i], ""); err != nil {
				return nil, false, fmt.Errorf("invalid ignore pattern in %s at line %d", relative, lineNumber)
			}
		}
		rules = append(rules, rule)
	}
	if err := scanner.Err(); err != nil {
		return nil, false, fmt.Errorf("read %s: %w", relative, err)
	}
	return rules, true, nil
}

func sourceIgnored(relative string, directory bool, rules []sourceIgnoreRule) bool {
	for i := len(rules) - 1; i >= 0; i-- {
		rule := rules[i]
		if rule.directoryOnly && !directory {
			continue
		}
		name := relative
		if rule.base != "" {
			if !strings.HasPrefix(name, rule.base+"/") {
				continue
			}
			name = strings.TrimPrefix(name, rule.base+"/")
		}
		if !rule.anchored {
			name = path.Base(name)
		}
		if sourceGlobMatch(rule.parts, strings.Split(name, "/")) {
			return !rule.negate
		}
	}
	return false
}

// path.Match gives identical slash/escape semantics on Windows and Unix.
// Memoized ** matching supports zero or more directories without exponential work.
func sourceGlobMatch(pattern, name []string) bool {
	seen, matched := map[[2]int]bool{}, map[[2]int]bool{}
	var match func(int, int) bool
	match = func(p, n int) bool {
		key := [2]int{p, n}
		if seen[key] {
			return matched[key]
		}
		seen[key] = true
		result := false
		if p == len(pattern) {
			result = n == len(name)
		} else if pattern[p] == "**" {
			// A trailing /** matches contents, not the directory itself.
			if p == len(pattern)-1 {
				result = n < len(name)
			} else {
				result = match(p+1, n) || (n < len(name) && match(p, n+1))
			}
		} else if n < len(name) {
			ok, _ := path.Match(pattern[p], name[n])
			result = ok && match(p+1, n+1)
		}
		matched[key] = result
		return result
	}
	return match(0, 0)
}
