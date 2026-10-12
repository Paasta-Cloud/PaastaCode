package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const version = "0.24.0"
const defaultServer = "https://console.paasta.cloud"
const maxProjectSourceBytes = 100 * 1024 * 1024

// Volume TUS traffic crosses the Kubernetes API server Pod proxy, whose
// default request ceiling is 3 MiB. Leave margin for proxy/request overhead.
const tusChunkBytes = 2 * 1024 * 1024
const maxSupportAttachmentBytes = 5 * 1024 * 1024

type config struct {
	Server string `json:"server"`
	Token  string `json:"token"`
}
type args struct {
	Command     string
	Positionals []string
	Flags       map[string]string
}
type plan struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	CPU     int    `json:"cpu_millicores"`
	Memory  int    `json:"memory_mib"`
	Monthly string `json:"monthly_price_toman"`
	Hourly  string `json:"hourly_price_toman"`
}
type cluster struct {
	ID       string `json:"id"`
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Location string `json:"location_name"`
	Flag     string `json:"flag_emoji"`
}
type storageOffering struct {
	ID         string `json:"id"`
	Cluster    string `json:"cluster_id"`
	Name       string `json:"name"`
	Monthly    string `json:"price_per_gb_month_toman"`
	Hourly     string `json:"price_per_gb_hour_toman"`
	AccessMode string `json:"access_mode"`
	MinSize    int    `json:"min_size_gb"`
	MaxSize    int    `json:"max_size_gb"`
}
type project struct {
	Name    string `json:"name"`
	Plan    string `json:"service_plan_id"`
	Billing string `json:"billing_mode"`
	Cluster string `json:"cluster_id"`
	Source  string `json:"source_type"`
	Status  string `json:"status"`
}
type context struct {
	Account struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Balance int64  `json:"balanceToman"`
	} `json:"account"`
	Plans            []plan            `json:"plans"`
	Clusters         []cluster         `json:"clusters"`
	Projects         []project         `json:"projects"`
	StorageOfferings []storageOffering `json:"storageOfferings"`
}
type projectView struct {
	Name      string `json:"name"`
	Domain    string `json:"domain"`
	Image     string `json:"image"`
	State     string `json:"state"`
	CreatedAt string `json:"createdAt"`
}
type deviceStart struct {
	DeviceCode, UserCode, VerificationURI, VerificationURIComplete string
	ExpiresIn, Interval                                            int
}
type buildState struct{ Status, Error, Logs, Domain string }
type apiError struct{ Error, Message string }
type backupView struct {
	Kind      string `json:"kind"`
	ID        string `json:"id"`
	Source    string `json:"source_volume_name"`
	Project   string `json:"source_project_name"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}
type databaseBackupView struct {
	ID                 string `json:"id"`
	Status             string `json:"status"`
	RestoreStatus      string `json:"restore_status"`
	VerificationStatus string `json:"verification_status"`
	CreatedAt          string `json:"created_at"`
}
type databaseAccessConnection struct {
	ID             string `json:"id"`
	Project        string `json:"project"`
	EnvironmentKey string `json:"environment_key"`
}
type databaseAccessCredential struct {
	ID           string                     `json:"id"`
	DatabaseName string                     `json:"database_name"`
	Username     string                     `json:"username"`
	IsPrimary    bool                       `json:"is_primary"`
	Status       string                     `json:"status"`
	Connections  []databaseAccessConnection `json:"connections"`
}
type databaseAccessResult struct {
	Engine      string                     `json:"engine"`
	Credentials []databaseAccessCredential `json:"credentials"`
	Projects    []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"projects"`
}
type databaseCredentialMutation struct {
	OK           bool           `json:"ok"`
	CredentialID string         `json:"credentialId,omitempty"`
	ConnectionID string         `json:"connectionId,omitempty"`
	Environment  string         `json:"environmentKey,omitempty"`
	Connection   map[string]any `json:"connection,omitempty"`
}
type notificationChannelView struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Destination *string `json:"destination"`
	URL         *string `json:"url"`
	Enabled     bool    `json:"enabled"`
}
type notificationPreferenceView struct {
	Kind  string `json:"kind"`
	Email bool   `json:"email"`
	SMS   bool   `json:"sms"`
}
type notificationDeliveryView struct {
	ID           string  `json:"id"`
	ChannelName  string  `json:"channel_name"`
	ChannelKind  string  `json:"channel_kind"`
	Event        string  `json:"event"`
	Status       string  `json:"status"`
	Attempts     int     `json:"attempts"`
	ResponseCode *int    `json:"response_status"`
	LastError    *string `json:"last_error"`
	CreatedAt    string  `json:"created_at"`
}
type notificationsResult struct {
	Channels     []notificationChannelView    `json:"channels"`
	Deliveries   []notificationDeliveryView   `json:"deliveries"`
	Preferences  []notificationPreferenceView `json:"preferences"`
	Availability struct {
		Email bool `json:"email"`
		SMS   bool `json:"sms"`
	} `json:"availability"`
	Members []string `json:"members"`
}
type supportTicketView struct {
	ID            string  `json:"id"`
	Number        string  `json:"number"`
	Subject       string  `json:"subject"`
	Category      string  `json:"category"`
	Priority      string  `json:"priority"`
	Status        string  `json:"status"`
	Project       *string `json:"project_name"`
	CreatedBy     string  `json:"created_by_name"`
	AssignedTo    *string `json:"assigned_name"`
	LastMessageAt string  `json:"last_message_at"`
	MessageCount  int     `json:"message_count"`
}
type supportMessageView struct {
	ID             string  `json:"id"`
	SenderName     string  `json:"sender_name"`
	Body           string  `json:"body"`
	Staff          bool    `json:"is_staff"`
	AttachmentName *string `json:"attachment_name"`
	AttachmentSize *int64  `json:"attachment_size"`
	CreatedAt      string  `json:"created_at"`
}
type supportTicketsResult struct {
	Tickets []supportTicketView `json:"tickets"`
}
type supportTicketResult struct {
	Ticket   supportTicketView    `json:"ticket"`
	Messages []supportMessageView `json:"messages"`
}
type cdnPlanView struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	MonthlyPrice     string   `json:"monthly_price_toman"`
	TrafficGB        int      `json:"traffic_gb"`
	MaxDNSRecords    int      `json:"max_dns_records"`
	MaxFirewallRules int      `json:"max_firewall_rules"`
	MaxPurgeRequests int      `json:"max_purge_requests"`
	Features         []string `json:"features"`
}
type cdnSiteView struct {
	ID             string `json:"id"`
	Domain         string `json:"domain"`
	Status         string `json:"status"`
	PlanID         string `json:"plan_id"`
	PlanName       string `json:"plan_name"`
	MonthlyPrice   string `json:"monthly_price_toman"`
	TrafficBytes   string `json:"traffic_bytes"`
	TrafficGB      int    `json:"traffic_gb"`
	PeriodEnd      string `json:"current_period_end"`
	CancelAtPeriod bool   `json:"cancel_at_period_end"`
}
type cdnInventoryResult struct {
	Sites       []cdnSiteView `json:"sites"`
	Plans       []cdnPlanView `json:"plans"`
	Nameservers []string      `json:"nameservers"`
}
type deploymentView struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	Stack          string `json:"stack"`
	Trigger        string `json:"trigger"`
	SourceRevision string `json:"source_revision"`
	Active         bool   `json:"active"`
	CreatedAt      string `json:"created_at"`
}
type previewView struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Domain    string `json:"domain"`
	Status    string `json:"status"`
	BuildID   string `json:"build_id"`
	ExpiresAt string `json:"expires_at"`
}
type retryView struct {
	ID         string `json:"id"`
	Project    string `json:"project"`
	Status     string `json:"status"`
	RetryStage string `json:"retryStage"`
}
type processView struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	Command       string `json:"command"`
	Schedule      string `json:"schedule"`
	Status        string `json:"status"`
	Replicas      int    `json:"desired_replicas"`
	Billing       string `json:"billing_mode"`
	Plan          string `json:"plan_name"`
	Monthly       string `json:"monthly_price_toman"`
	Hourly        string `json:"hourly_price_toman"`
	LastError     string `json:"last_error"`
	CurrentPeriod string `json:"current_period_end"`
}
type processMutationView struct {
	OK          bool   `json:"ok"`
	ID          string `json:"id,omitempty"`
	ExecutionID string `json:"executionId,omitempty"`
	Charged     int64  `json:"chargedToman,omitempty"`
	Balance     int64  `json:"balanceToman,omitempty"`
	Refunded    int64  `json:"refundedToman,omitempty"`
	Status      string `json:"status,omitempty"`
}
type processLogView struct {
	Logs    string `json:"logs"`
	Phase   string `json:"phase"`
	Message string `json:"message"`
}
type availabilityView struct {
	Autoscaling       bool   `json:"autoscaling"`
	HighAvailability  bool   `json:"highAvailability"`
	MinReplicas       int    `json:"minReplicas"`
	MaxReplicas       int    `json:"maxReplicas"`
	CPUTarget         int    `json:"cpuTarget"`
	DesiredReplicas   int    `json:"desiredReplicas"`
	Stack             string `json:"stack"`
	BillingMode       string `json:"billingMode"`
	PlanName          string `json:"planName"`
	MonthlyPriceToman string `json:"monthlyPriceToman"`
	HourlyPriceToman  string `json:"hourlyPriceToman"`
	HasRwoVolume      bool   `json:"hasRwoVolume"`
}
type availabilityMutationView struct {
	OK               bool  `json:"ok"`
	Autoscaling      bool  `json:"autoscaling"`
	HighAvailability bool  `json:"highAvailability"`
	MinReplicas      int   `json:"minReplicas"`
	MaxReplicas      int   `json:"maxReplicas"`
	CPUTarget        int   `json:"cpuTarget"`
	DesiredReplicas  int   `json:"desiredReplicas"`
	ChargedToman     int64 `json:"chargedToman"`
	BalanceToman     int64 `json:"balanceToman"`
}
type resourceAlertRuleView struct {
	ID               string `json:"id"`
	ServiceName      string `json:"service_name"`
	Metric           string `json:"metric"`
	ThresholdPercent int    `json:"threshold_percent"`
	DurationMinutes  int    `json:"duration_minutes"`
	Severity         string `json:"severity"`
	Enabled          bool   `json:"enabled"`
}
type monitorCheckView struct {
	CheckedAt string `json:"checkedAt"`
	OK        bool   `json:"ok"`
	Status    *int   `json:"statusCode"`
	Latency   int    `json:"latencyMs"`
	Error     string `json:"error"`
}
type monitorView struct {
	OK                  bool               `json:"ok,omitempty"`
	Enabled             bool               `json:"enabled"`
	Path                string             `json:"path"`
	FailureThreshold    int                `json:"failureThreshold"`
	ConsecutiveFailures int                `json:"consecutiveFailures"`
	LastStatus          *int               `json:"lastStatus"`
	LastLatency         *int               `json:"lastLatencyMs"`
	LastError           string             `json:"lastError"`
	LastCheckedAt       string             `json:"lastCheckedAt"`
	Availability24h     *float64           `json:"availability24h"`
	Checks              []monitorCheckView `json:"checks,omitempty"`
}
type gitConnectionView struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Username  string `json:"username"`
	CreatedAt string `json:"createdAt"`
}
type gitProjectView struct {
	Project           string `json:"project"`
	Repository        string `json:"repository"`
	Ref               string `json:"ref"`
	Root              string `json:"root"`
	AutoDeploy        bool   `json:"autoDeploy"`
	WebhookConfigured bool   `json:"webhookConfigured"`
	ManagedWebhook    bool   `json:"managedWebhook"`
	ConnectedAccount  bool   `json:"connectedAccount"`
}
type teamMemberView struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Email      string   `json:"email"`
	Role       string   `json:"role"`
	ProjectIDs []string `json:"project_ids"`
}
type teamInvitationView struct {
	ID         string   `json:"id"`
	Email      string   `json:"email"`
	Role       string   `json:"role"`
	ProjectIDs []string `json:"project_ids"`
	ExpiresAt  string   `json:"expires_at"`
}
type teamInventory struct {
	Members     []teamMemberView     `json:"members"`
	Invitations []teamInvitationView `json:"invitations"`
	Projects    []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"projects"`
}
type registeredDomainView struct {
	ID             string   `json:"id"`
	FQDN           string   `json:"fqdn"`
	TLD            string   `json:"tld"`
	Status         string   `json:"status"`
	ExpiresAt      *string  `json:"expires_at"`
	AutoRenew      bool     `json:"auto_renew"`
	TransferLocked *bool    `json:"transfer_locked"`
	Nameservers    []string `json:"nameservers"`
	OrderID        *string  `json:"order_id"`
	OrderStatus    *string  `json:"order_status"`
	OrderOperation *string  `json:"order_operation"`
}
type registeredDomainInventory struct {
	Domains []registeredDomainView `json:"domains"`
}
type domainQuoteView struct {
	Domain     string         `json:"domain"`
	TLD        string         `json:"tld"`
	Provider   string         `json:"provider"`
	Operation  string         `json:"operation"`
	Years      int            `json:"years"`
	Available  *bool          `json:"available"`
	Premium    bool           `json:"premium"`
	Privacy    bool           `json:"privacy"`
	PriceToman int            `json:"priceToman"`
	Prices     map[string]int `json:"prices"`
}
type domainOrderView struct {
	OK        bool   `json:"ok"`
	Recovered bool   `json:"recovered"`
	OrderID   string `json:"orderId"`
	DomainID  string `json:"domainId"`
	Status    string `json:"status"`
}

var client = &http.Client{Timeout: 45 * time.Second}
var colors = os.Getenv("NO_COLOR") == "" && terminal(os.Stdout)

func terminal(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
func color(code, value string) string {
	if !colors {
		return value
	}
	return "\x1b[" + code + "m" + value + "\x1b[0m"
}
func step(value string)    { fmt.Println(color("36", "◆") + " " + value) }
func success(value string) { fmt.Println(color("32", "✓") + " " + value) }

func parse(values []string) args {
	result := args{Flags: map[string]string{}}
	if len(values) > 0 {
		result.Command = values[0]
		values = values[1:]
	} else {
		result.Command = "help"
	}
	aliases := map[string]string{"-y": "yes", "-f": "follow", "-n": "name", "-p": "plan", "-r": "region"}
	for i := 0; i < len(values); i++ {
		value := values[i]
		if value == "--" {
			result.Positionals = append(result.Positionals, values[i+1:]...)
			break
		}
		if name, ok := aliases[value]; ok {
			value = "--" + name
		}
		if !strings.HasPrefix(value, "--") {
			result.Positionals = append(result.Positionals, value)
			continue
		}
		parts := strings.SplitN(strings.TrimPrefix(value, "--"), "=", 2)
		if len(parts) == 1 && (parts[0] == "dry-run" || parts[0] == "json") {
			result.Flags[parts[0]] = "true"
			if i+1 < len(values) && (values[i+1] == "true" || values[i+1] == "false") {
				i++
				result.Flags[parts[0]] = values[i]
			}
			continue
		}
		if len(parts) == 2 {
			result.Flags[parts[0]] = parts[1]
			continue
		}
		if i+1 < len(values) && !strings.HasPrefix(values[i+1], "-") {
			result.Flags[parts[0]] = values[i+1]
			i++
		} else {
			result.Flags[parts[0]] = "true"
		}
	}
	return result
}

func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "paasta", "config.json"), nil
}
func loadConfig() (config, error) {
	if token := strings.TrimSpace(os.Getenv("PAASTA_RUNTIME_TOKEN")); token != "" {
		server := strings.TrimSpace(os.Getenv("PAASTA_RUNTIME_SERVER"))
		if server == "" {
			server = defaultServer
		}
		parsed, err := url.Parse(server)
		if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))) {
			return config{}, errors.New("runtime server must be an HTTPS origin")
		}
		if len(token) > 512 || strings.ContainsAny(token, "\r\n") {
			return config{}, errors.New("invalid runtime token")
		}
		// PaastaCode supplies a scoped in-memory grant; never overwrite the user's CLI login.
		return config{Server: parsed.Scheme + "://" + parsed.Host, Token: token}, nil
	}
	path, err := configPath()
	if err != nil {
		return config{}, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return config{}, errors.New("not logged in; run: paasta login")
	}
	var value config
	if json.Unmarshal(body, &value) != nil || value.Token == "" {
		return config{}, errors.New("not logged in; run: paasta login")
	}
	return value, nil
}
func saveConfig(value config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	body, _ := json.MarshalIndent(value, "", "  ")
	return os.WriteFile(path, body, 0600)
}

func endpoint(server, path string) string { return strings.TrimRight(server, "/") + path }

type apiHTTPError struct {
	StatusCode int
	Message    string
}

func (err *apiHTTPError) Error() string {
	if err.Message != "" {
		return err.Message
	}
	return fmt.Sprintf("request failed: HTTP %d", err.StatusCode)
}

var apiRetrySleep = time.Sleep

func transientAPIStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func requestRaw(method, target string, body io.Reader, contentType, token string) (*http.Response, []byte, error) {
	req, err := http.NewRequest(method, target, body)
	if err != nil {
		return nil, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("User-Agent", "paasta-cli/"+version)
	response, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	return response, data, err
}
func api(method, path string, input, output any, cfg config) error {
	var body io.Reader
	contentType := ""
	if input != nil {
		data, _ := json.Marshal(input)
		body = bytes.NewReader(data)
		contentType = "application/json"
	}
	response, data, err := requestRaw(method, endpoint(cfg.Server, path), body, contentType, cfg.Token)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem apiError
		_ = json.Unmarshal(data, &problem)
		if problem.Message != "" {
			return &apiHTTPError{StatusCode: response.StatusCode, Message: problem.Message}
		}
		if problem.Error != "" {
			return &apiHTTPError{StatusCode: response.StatusCode, Message: problem.Error}
		}
		return &apiHTTPError{StatusCode: response.StatusCode}
	}
	if output != nil && len(data) > 0 {
		return json.Unmarshal(data, output)
	}
	return nil
}

func apiWithTransientRetry(method, path string, input, output any, cfg config, attempts int) error {
	if attempts < 1 {
		attempts = 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		err := api(method, path, input, output, cfg)
		if err == nil {
			return nil
		}
		var responseErr *apiHTTPError
		if method != http.MethodGet || !errors.As(err, &responseErr) || !transientAPIStatus(responseErr.StatusCode) || attempt+1 == attempts {
			return err
		}
		delay := time.Second << attempt
		if delay > 8*time.Second {
			delay = 8 * time.Second
		}
		apiRetrySleep(delay)
	}
	return nil
}

func newerVersion(current, latest string) bool {
	parse := func(value string) [3]int {
		parts := strings.Split(strings.TrimPrefix(strings.TrimSpace(value), "v"), ".")
		var result [3]int
		for index := 0; index < len(parts) && index < 3; index++ {
			result[index], _ = strconv.Atoi(parts[index])
		}
		return result
	}
	a, b := parse(current), parse(latest)
	for index := range a {
		if b[index] != a[index] {
			return b[index] > a[index]
		}
	}
	return false
}

func latestVersion(server string, timeout time.Duration) (string, error) {
	updateClient := &http.Client{Timeout: timeout}
	response, err := updateClient.Get(endpoint(server, "/cli/latest/version.json"))
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", fmt.Errorf("update server returned HTTP %d", response.StatusCode)
	}
	var result struct {
		Version string `json:"version"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&result); err != nil || result.Version == "" {
		return "", errors.New("invalid update metadata")
	}
	return result.Version, nil
}

func checkForUpdate(server string) {
	latest, err := latestVersion(server, 1500*time.Millisecond)
	if err == nil && newerVersion(version, latest) {
		fmt.Fprintf(os.Stderr, "Update available: paasta %s → %s. Run: paasta update\n", version, latest)
	}
}

func binaryName() (string, error) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		return "", errors.New("automatic update is not supported on this operating system")
	}
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return "", errors.New("automatic update is not supported on this architecture")
	}
	name := "paasta-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name, nil
}

func windowsUpdateScript(temporaryName, executable, helperName string) string {
	return fmt.Sprintf(`@echo off
set attempts=0
:retry
move /Y "%s" "%s" >NUL 2>&1
if not errorlevel 1 goto done
set /a attempts+=1
if %%attempts%% GEQ 60 goto failed
ping 127.0.0.1 -n 2 >NUL
goto retry
:failed
echo Paasta CLI could not replace the running executable. Run paasta update again from a terminal with write access.>"%s.update-error.txt"
:done
del "%s"
`, temporaryName, executable, executable, helperName)
}

func updateCLI(server string) error {
	latest, err := latestVersion(server, 15*time.Second)
	if err != nil {
		return err
	}
	if !newerVersion(version, latest) {
		success("Paasta CLI is already up to date (" + version + ")")
		return nil
	}
	name, err := binaryName()
	if err != nil {
		return err
	}
	step("Downloading Paasta CLI " + latest)
	updateClient := &http.Client{Timeout: 2 * time.Minute}
	download := func(target string, maximum int64) ([]byte, error) {
		response, requestErr := updateClient.Get(endpoint(server, "/cli/latest/"+target))
		if requestErr != nil {
			return nil, requestErr
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			return nil, fmt.Errorf("download failed: HTTP %d", response.StatusCode)
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, maximum+1))
		if int64(len(body)) > maximum {
			return nil, errors.New("update download is unexpectedly large")
		}
		return body, readErr
	}
	binary, err := download(name, 100*1024*1024)
	if err != nil {
		return err
	}
	checksum, err := download(name+".sha256", 1024)
	if err != nil {
		return err
	}
	expected := strings.Fields(string(checksum))
	actual := fmt.Sprintf("%x", sha256.Sum256(binary))
	if len(expected) == 0 || !strings.EqualFold(expected[0], actual) {
		return errors.New("downloaded CLI checksum does not match; update canceled")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(executable), ".paasta-update-*")
	if err != nil {
		return fmt.Errorf("cannot write beside %s; retry with sufficient permission: %w", executable, err)
	}
	temporaryName := temporary.Name()
	keepTemporary := false
	defer func() {
		if !keepTemporary {
			_ = os.Remove(temporaryName)
		}
	}()
	if _, err = temporary.Write(binary); err != nil {
		temporary.Close()
		return err
	}
	if err = temporary.Close(); err != nil {
		return err
	}
	if err = os.Chmod(temporaryName, 0755); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		helperName := temporaryName + ".cmd"
		if err = os.WriteFile(helperName, []byte(windowsUpdateScript(temporaryName, executable, helperName)), 0600); err != nil {
			return fmt.Errorf("cannot prepare Windows update helper: %w", err)
		}
		command := exec.Command("cmd.exe", "/D", "/C", helperName)
		if err = command.Start(); err != nil {
			_ = os.Remove(helperName)
			return err
		}
		keepTemporary = true
		success("Downloaded Paasta CLI " + latest + "; replacement will complete after this command exits")
		return nil
	} else if err = os.Rename(temporaryName, executable); err != nil {
		return fmt.Errorf("cannot replace %s; retry with sufficient permission: %w", executable, err)
	}
	success("Updated Paasta CLI to " + latest)
	return nil
}

func openBrowser(target string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	case "darwin":
		command = exec.Command("open", target)
	default:
		command = exec.Command("xdg-open", target)
	}
	return command.Start()
}

func login(server, apiKey string) error {
	parsed, err := url.Parse(server)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1") {
		return errors.New("server must be a valid HTTPS URL")
	}
	origin := parsed.Scheme + "://" + parsed.Host
	if apiKey == "true" {
		apiKey = strings.TrimSpace(os.Getenv("PAASTA_API_KEY"))
		if apiKey == "" {
			return errors.New("--api-key needs a token value or the PAASTA_API_KEY environment variable")
		}
	}
	if apiKey != "" {
		cfg := config{Server: origin, Token: strings.TrimSpace(apiKey)}
		var ctx context
		if err = api("GET", "/api/cli/context", nil, &ctx, cfg); err != nil {
			return fmt.Errorf("API key is invalid, expired, or missing a required scope: %w", err)
		}
		if err = saveConfig(cfg); err != nil {
			return err
		}
		success("Logged in with API key as " + ctx.Account.Email)
		return nil
	}
	host, _ := os.Hostname()
	payload, _ := json.Marshal(map[string]string{"clientName": "Paasta CLI on " + host})
	response, data, err := requestRaw("POST", endpoint(origin, "/api/cli/device"), bytes.NewReader(payload), "application/json", "")
	if err != nil {
		return err
	}
	if response.StatusCode != 201 {
		return fmt.Errorf("could not start login: %s", strings.TrimSpace(string(data)))
	}
	var started deviceStart
	if err = json.Unmarshal(data, &started); err != nil {
		return err
	}
	fmt.Println("\n" + color("1", "Sign in to Paasta"))
	fmt.Println("Copy and open this complete link:")
	fmt.Println(color("4;36", started.VerificationURIComplete))
	fmt.Println("Confirmation code:", color("1;33", started.UserCode))
	if err = openBrowser(started.VerificationURIComplete); err == nil {
		fmt.Println("Your browser has been opened. If it did not open, copy the link above.")
	} else {
		fmt.Println("Paste the complete link above into any browser.")
	}
	fmt.Print("Waiting for approval")
	deadline := time.Now().Add(time.Duration(started.ExpiresIn) * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(max(started.Interval, 3)) * time.Second)
		fmt.Print(".")
		body, _ := json.Marshal(map[string]string{"deviceCode": started.DeviceCode})
		poll, result, requestErr := requestRaw("POST", endpoint(origin, "/api/cli/device/token"), bytes.NewReader(body), "application/json", "")
		if requestErr != nil {
			continue
		}
		if poll.StatusCode == 202 {
			continue
		}
		fmt.Println()
		if poll.StatusCode != 200 {
			var problem apiError
			_ = json.Unmarshal(result, &problem)
			if problem.Message != "" {
				return errors.New(problem.Message)
			}
			return errors.New("login was not approved")
		}
		var token struct{ Token string }
		if json.Unmarshal(result, &token) != nil || token.Token == "" {
			return errors.New("invalid login response")
		}
		cfg := config{Server: origin, Token: token.Token}
		if err = saveConfig(cfg); err != nil {
			return err
		}
		var ctx context
		if err = api("GET", "/api/cli/context", nil, &ctx, cfg); err != nil {
			return err
		}
		success("Logged in as " + ctx.Account.Email)
		return nil
	}
	fmt.Println()
	return errors.New("login request expired")
}

var skipped = map[string]bool{".git": true, ".paasta": true, ".paastacode": true, ".ssh": true, ".kube": true, ".aws": true, ".gnupg": true, "node_modules": true, ".next": true, ".nuxt": true, ".svelte-kit": true, ".venv": true, "venv": true, "__pycache__": true, "target": true, "bin": true, "obj": true}

func sensitive(name string) bool {
	lower := strings.ToLower(name)
	return lower == ".ds_store" || lower == "id_rsa" || lower == "id_ed25519" || lower == "id_ecdsa" || lower == "id_dsa" || strings.HasPrefix(lower, "kubeconfig") || strings.HasSuffix(lower, ".kubeconfig") || environmentFile(lower) || strings.HasSuffix(lower, ".pem") || strings.HasSuffix(lower, ".key") || strings.HasSuffix(lower, ".p12") || strings.HasSuffix(lower, ".pfx")
}

func environmentFile(name string) bool {
	lower := strings.ToLower(name)
	return lower == ".env" || (strings.HasPrefix(lower, ".env.") && !strings.HasSuffix(lower, ".example") && !strings.HasSuffix(lower, ".sample") && !strings.HasSuffix(lower, ".template")) || (strings.HasSuffix(lower, ".env") && !strings.HasSuffix(lower, ".example") && !strings.HasSuffix(lower, ".sample") && !strings.HasSuffix(lower, ".template"))
}

func parseEnvironment(content string) map[string]string {
	result := map[string]string{}
	for _, raw := range strings.Split(strings.TrimPrefix(content, "\ufeff"), "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		valid := key != ""
		for index, char := range key {
			if !((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char == '_' || (index > 0 && char >= '0' && char <= '9')) {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		value := strings.TrimSpace(parts[1])
		if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
			value = value[1 : len(value)-1]
		}
		result[key] = value
	}
	return result
}

func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	dash := false
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			out.WriteRune(char)
			dash = false
		} else if !dash && out.Len() > 0 {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(out.String(), "-")
}
func prompt(label, fallback string) string {
	reader := bufio.NewReader(os.Stdin)
	if fallback != "" {
		fmt.Printf("%s [%s]: ", label, fallback)
	} else {
		fmt.Printf("%s: ", label)
	}
	value, _ := reader.ReadString('\n')
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
func choose(label string, values []string, fallback int) int {
	fmt.Println(label)
	for index, value := range values {
		marker := " "
		if index == fallback {
			marker = "*"
		}
		fmt.Printf("  %s %d) %s\n", marker, index+1, value)
	}
	selected := prompt("Choose", strconv.Itoa(fallback+1))
	number, _ := strconv.Atoi(selected)
	if number < 1 || number > len(values) {
		return fallback
	}
	return number - 1
}
func findProject(items []project, name string) *project {
	for index := range items {
		if items[index].Name == name {
			return &items[index]
		}
	}
	return nil
}
func value(values map[string]string, key, fallback string) string {
	if values[key] != "" && values[key] != "true" {
		return values[key]
	}
	return fallback
}

type deploySource struct {
	archive    []byte
	files      int
	bytes      int64
	image, git string
}
type composeMount struct {
	Source, Target string
}
type composeService struct {
	Name    string
	Volumes []composeMount
}
type composeInspection struct {
	Volumes  []string
	Services []composeService
}
type requestedVolume struct {
	OfferingID  string `json:"offeringId"`
	SizeGB      int    `json:"sizeGb"`
	Name        string `json:"name"`
	MountPath   string `json:"mountPath"`
	BillingMode string `json:"billingMode"`
}

func composeVolumeRequests(compose *composeInspection, offerings []storageOffering, clusterID, billing string, flags map[string]string, interactive bool) ([]requestedVolume, error) {
	if compose == nil || len(compose.Volumes) == 0 {
		return nil, nil
	}
	if raw := flags["volumes"]; raw != "" {
		var requests []requestedVolume
		if err := json.Unmarshal([]byte(raw), &requests); err != nil || len(requests) != len(compose.Volumes) {
			return nil, errors.New("--volumes must be a JSON array with one item per detected Compose volume")
		}
		return requests, nil
	}
	available := make([]storageOffering, 0)
	for _, offering := range offerings {
		if offering.Cluster == clusterID {
			available = append(available, offering)
		}
	}
	if len(available) == 0 {
		return nil, errors.New("no persistent storage offering is available in the selected region")
	}
	sort.SliceStable(available, func(i, j int) bool {
		left, right := available[i].Hourly, available[j].Hourly
		if billing == "monthly" {
			left, right = available[i].Monthly, available[j].Monthly
		}
		leftPrice, _ := strconv.ParseInt(left, 10, 64)
		rightPrice, _ := strconv.ParseInt(right, 10, 64)
		return leftPrice < rightPrice
	})
	selectedOffering := value(flags, "volume-offering", available[0].ID)
	if flags["volume-offering"] != "" {
		found := false
		for _, offering := range available {
			if offering.ID == selectedOffering || strings.EqualFold(offering.Name, selectedOffering) {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("volume offering %s is not available in the selected region", selectedOffering)
		}
	}
	selectedSize, _ := strconv.Atoi(value(flags, "volume-size", "0"))
	requests := make([]requestedVolume, 0, len(compose.Volumes))
	for _, name := range compose.Volumes {
		mountPath := "/data"
		for _, service := range compose.Services {
			for _, mount := range service.Volumes {
				if mount.Source == name {
					mountPath = mount.Target
					break
				}
			}
		}
		offeringIndex := 0
		for index, offering := range available {
			if offering.ID == selectedOffering || strings.EqualFold(offering.Name, selectedOffering) {
				offeringIndex = index
				break
			}
		}
		if interactive && flags["volume-offering"] == "" {
			choices := make([]string, len(available))
			for index, offering := range available {
				price := offering.Hourly + " toman/GB/hour"
				if billing == "monthly" {
					price = offering.Monthly + " toman/GB/month"
				}
				choices[index] = fmt.Sprintf("%s · %s · %d-%d GB", offering.Name, price, offering.MinSize, offering.MaxSize)
			}
			offeringIndex = choose("Storage for "+name+" → "+mountPath, choices, offeringIndex)
		}
		offering := available[offeringIndex]
		size := selectedSize
		if size == 0 {
			size = offering.MinSize
		}
		if interactive && flags["volume-size"] == "" {
			size, _ = strconv.Atoi(prompt("Size for "+name+" (GB)", strconv.Itoa(size)))
		}
		if size < offering.MinSize || size > offering.MaxSize {
			return nil, fmt.Errorf("volume %s size must be between %d and %d GB", name, offering.MinSize, offering.MaxSize)
		}
		requests = append(requests, requestedVolume{OfferingID: offering.ID, SizeGB: size, Name: name, MountPath: mountPath, BillingMode: billing})
		fmt.Printf("  • %s → %s · %d GB · %s\n", name, mountPath, size, offering.Name)
	}
	return requests, nil
}

func multipartBody(fields map[string]string, source deploySource) (*bytes.Buffer, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if fields[key] != "" {
			_ = writer.WriteField(key, fields[key])
		}
	}
	if len(source.archive) > 0 {
		part, err := writer.CreateFormFile("archive", "source.zip")
		if err != nil {
			return nil, "", err
		}
		if _, err = part.Write(source.archive); err != nil {
			return nil, "", err
		}
	}
	if source.image != "" {
		_ = writer.WriteField("imageReference", source.image)
	}
	if source.git != "" {
		_ = writer.WriteField("gitUrl", source.git)
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &body, writer.FormDataContentType(), nil
}
func sendMultipart(path string, fields map[string]string, source deploySource, cfg config, output any) error {
	body, contentType, err := multipartBody(fields, source)
	if err != nil {
		return err
	}
	response, data, err := requestRaw("POST", endpoint(cfg.Server, path), body, contentType, cfg.Token)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem apiError
		_ = json.Unmarshal(data, &problem)
		if problem.Error != "" {
			return errors.New(problem.Error)
		}
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	return json.Unmarshal(data, output)
}

func deploy(command args, cfg config) error {
	if command.Flags["dry-run"] == "true" {
		return previewSource(command)
	}
	var ctx context
	if err := api("GET", "/api/cli/context", nil, &ctx, cfg); err != nil {
		return err
	}
	if len(ctx.Plans) == 0 || len(ctx.Clusters) == 0 {
		return errors.New("no active plan or region is available")
	}
	directory := "."
	if len(command.Positionals) > 0 {
		directory = command.Positionals[0]
	}
	absolute, _ := filepath.Abs(directory)
	name := slug(value(command.Flags, "name", filepath.Base(absolute)))
	interactive := terminal(os.Stdin) && command.Flags["yes"] != "true"
	if interactive {
		name = slug(prompt("Project name", name))
	}
	if name == "" {
		return errors.New("project name is required")
	}
	existing := findProject(ctx.Projects, name)
	planID, clusterID, billing := "", "", "payg"
	if existing != nil {
		planID, clusterID, billing = existing.Plan, existing.Cluster, existing.Billing
		step("Redeploying " + name)
	} else {
		planID = value(command.Flags, "plan", ctx.Plans[0].ID)
		clusterID = value(command.Flags, "region", ctx.Clusters[0].ID)
		billing = value(command.Flags, "billing", "payg")
		if interactive && command.Flags["plan"] == "" {
			choices := make([]string, len(ctx.Plans))
			for i, plan := range ctx.Plans {
				choices[i] = fmt.Sprintf("%s · %dm CPU · %dMiB RAM · %s toman/month", plan.Name, plan.CPU, plan.Memory, plan.Monthly)
			}
			planID = ctx.Plans[choose("Service plan", choices, 0)].ID
		}
		if interactive && command.Flags["billing"] == "" {
			billing = []string{"payg", "monthly"}[choose("Billing", []string{"Pay as you go", "Monthly prepaid"}, 0)]
		}
		if interactive && command.Flags["region"] == "" {
			choices := make([]string, len(ctx.Clusters))
			for i, region := range ctx.Clusters {
				choices[i] = region.Flag + " " + region.Name + " · " + region.Location
			}
			clusterID = ctx.Clusters[choose("Region", choices, 0)].ID
		}
	}
	if billing != "payg" && billing != "monthly" {
		return errors.New("billing must be payg or monthly")
	}
	fields := map[string]string{"name": name, "servicePlanId": planID, "clusterId": clusterID, "billingMode": billing, "port": command.Flags["port"], "healthPath": command.Flags["health"], "startCommand": command.Flags["start"]}
	if existing != nil {
		fields["redeploy"] = "true"
	}
	for _, key := range []string{"volumeOfferingId", "volumeSizeGb", "volumeName", "volumeMountPath", "volumeBillingMode", "databasePlanId", "databaseStorageOfferingId", "databaseSizeGb", "databaseName", "databaseBillingMode"} {
		dashed := strings.NewReplacer("Offering", "-offering-", "Storage", "-storage-", "Size", "-size-", "Mount", "-mount-", "Billing", "-billing-", "Plan", "-plan-", "Name", "-name").Replace(key)
		dashed = strings.Trim(strings.ToLower(dashed), "-")
		if command.Flags[dashed] != "" {
			fields[key] = command.Flags[dashed]
		}
	}
	var source deploySource
	if command.Flags["image"] != "" {
		source.image = command.Flags["image"]
		step("Using Docker image " + source.image)
	} else if command.Flags["git"] != "" {
		source.git = command.Flags["git"]
		fields["gitRef"] = value(command.Flags, "ref", "main")
		fields["gitRoot"] = command.Flags["root"]
		fields["gitToken"] = command.Flags["token"]
		fields["gitConnectionId"] = command.Flags["connection"]
		if fields["gitConnectionId"] != "" && !validUUID(fields["gitConnectionId"]) {
			return errors.New("--connection must be a Git connection UUID from `paasta git connections`")
		}
		step("Using Git repository " + source.git)
	} else {
		step("Packing source safely")
		selection, err := selectSource(absolute)
		if err != nil {
			return err
		}
		if len(selection.IgnoreFiles) > 0 {
			step("Applying ignore rules from " + strings.Join(selection.IgnoreFiles, ", "))
		}
		environment, environmentFiles, err := map[string]string{}, 0, error(nil)
		if command.Flags["no-env"] != "true" {
			environment, environmentFiles, err = selection.collectEnvironment()
		}
		if err != nil {
			return err
		}
		if len(environment) > 50 {
			return errors.New("a maximum of 50 environment variables is supported")
		}
		if len(environment) > 0 {
			encoded, encodeErr := json.Marshal(environment)
			if encodeErr != nil {
				return encodeErr
			}
			fields["environment"] = string(encoded)
			success(fmt.Sprintf("Loaded %d environment variables from %d private file(s)", len(environment), environmentFiles))
		}
		archive, files, size, err := selection.archive()
		if err != nil {
			return err
		}
		if expected := command.Flags["source-sha256"]; expected != "" && expected != fmt.Sprintf("%x", sha256.Sum256(archive)) {
			return errors.New("source changed after approval; review a new preview before deployment")
		}
		source = deploySource{archive: archive, files: files, bytes: size}
		success(fmt.Sprintf("Packed %d files · %.2f MiB", files, float64(size)/1024/1024))
	}
	step("Inspecting project")
	var inspected struct {
		Stack, Domain       string
		Port, Files         int
		MinimumMemory       int                `json:"minimumMemoryMib"`
		RequiredEnvironment []string           `json:"requiredEnvironment"`
		Compose             *composeInspection `json:"compose"`
	}
	if err := sendMultipart("/api/projects/inspect", fields, source, cfg, &inspected); err != nil {
		return err
	}
	success(fmt.Sprintf("%s · port %d · %s", inspected.Stack, inspected.Port, inspected.Domain))
	if len(inspected.RequiredEnvironment) > 0 {
		return fmt.Errorf("missing required environment variables: %s; add them in the project settings or a .env file allowed by your ignore rules, then run deploy again", strings.Join(inspected.RequiredEnvironment, ", "))
	}
	if command.Flags["no-addons"] == "true" && existing == nil && inspected.Compose != nil && len(inspected.Compose.Volumes) > 0 {
		return errors.New("this Compose project needs separately priced storage; configure and review its resources in Paasta before deployment")
	}
	if existing == nil {
		volumes, volumeErr := composeVolumeRequests(inspected.Compose, ctx.StorageOfferings, clusterID, billing, command.Flags, interactive)
		if volumeErr != nil {
			return volumeErr
		}
		if len(volumes) > 0 {
			encoded, encodeErr := json.Marshal(volumes)
			if encodeErr != nil {
				return encodeErr
			}
			fields["requestedVolumes"] = string(encoded)
			success(fmt.Sprintf("Configured %d persistent volume(s)", len(volumes)))
		}
	}
	if fields["port"] == "" {
		fields["port"] = strconv.Itoa(inspected.Port)
	}
	if !interactive && command.Flags["yes"] != "true" {
		return errors.New("use --yes in non-interactive environments")
	}
	if interactive && strings.ToLower(prompt("Deploy?", "yes")) != "yes" {
		return nil
	}
	step("Uploading source and queuing build")
	var started struct{ ID string }
	if err := sendMultipart("/api/projects/deploy", fields, source, cfg, &started); err != nil {
		return err
	}
	success("Build " + started.ID + " queued")
	if command.Flags["detach"] == "true" {
		return printJSON(map[string]any{"project": name, "deployment": started.ID, "status": "queued"})
	}
	lastLogs, lastStatus := "", ""
	for {
		var state buildState
		if err := apiWithTransientRetry(http.MethodGet, "/api/projects/deploy/"+url.PathEscape(started.ID), nil, &state, cfg, 5); err != nil {
			return err
		}
		if state.Logs != lastLogs {
			delta := state.Logs
			if strings.HasPrefix(state.Logs, lastLogs) {
				delta = strings.TrimPrefix(state.Logs, lastLogs)
			}
			if strings.TrimSpace(delta) != "" {
				fmt.Print(delta)
				if !strings.HasSuffix(delta, "\n") {
					fmt.Println()
				}
			}
			lastLogs = state.Logs
		}
		if state.Status != lastStatus {
			step("Status: " + state.Status)
			lastStatus = state.Status
		}
		switch state.Status {
		case "ready":
			success("Live at " + state.Domain)
			return nil
		case "failed", "canceled":
			if state.Error != "" {
				return errors.New(state.Error)
			}
			return errors.New("build " + state.Status)
		}
		time.Sleep(2 * time.Second)
	}
}

func projects(cfg config, jsonOutput bool) error {
	var items []projectView
	if err := api("GET", "/api/projects", nil, &items, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(items)
	}
	if len(items) == 0 {
		fmt.Println("No projects yet. Run: paasta deploy")
		return nil
	}
	for _, item := range items {
		fmt.Printf("%-26s %-12s %s\n", item.Name, item.State, item.Domain)
	}
	return nil
}
func printJSON(value any) error {
	body, err := json.MarshalIndent(value, "", "  ")
	if err == nil {
		fmt.Println(string(body))
	}
	return err
}
func projectStatus(name string, cfg config) error {
	var items []projectView
	if err := api("GET", "/api/projects", nil, &items, cfg); err != nil {
		return err
	}
	for _, item := range items {
		if item.Name == slug(name) {
			return printJSON(item)
		}
	}
	return errors.New("project not found")
}
func action(method, path string, payload any, cfg config) error {
	var result any
	if err := api(method, path, payload, &result, cfg); err != nil {
		return err
	}
	success("Done")
	return nil
}
func collection(path, key string, cfg config, jsonOutput bool) error {
	var result map[string]json.RawMessage
	if err := api("GET", path, nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	var items []map[string]any
	if err := json.Unmarshal(result[key], &items); err != nil {
		return err
	}
	if len(items) == 0 {
		fmt.Println("No items found.")
		return nil
	}
	for _, item := range items {
		name := fmt.Sprint(item["name"])
		if name == "<nil>" {
			name = fmt.Sprint(item["hostname"])
		}
		project := fmt.Sprint(item["project"])
		status := fmt.Sprint(item["status"])
		id := fmt.Sprint(item["id"])
		fmt.Printf("%-22s %-18s %-12s %s\n", name, project, status, id)
	}
	return nil
}
func backups(cfg config, jsonOutput bool) error {
	var result struct {
		Backups []backupView `json:"backups"`
	}
	if err := api("GET", "/api/backups", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Backups) == 0 {
		fmt.Println("No backups or snapshots found.")
		return nil
	}
	for _, item := range result.Backups {
		fmt.Printf("%-10s %-22s %-18s %-12s %s\n", item.Kind, item.Source, item.Project, item.Status, item.ID)
	}
	return nil
}
func downloadBackup(id, output string, overwrite bool, cfg config) (err error) {
	if id == "" || output == "" {
		return errors.New("use: paasta backup download ID --output FILE [--overwrite]")
	}
	return downloadToFile("/api/backups/"+url.PathEscape(id), output, overwrite, cfg)
}
func downloadToFile(path, output string, overwrite bool, cfg config) (err error) {
	return downloadToFileLimited(path, output, overwrite, 0, cfg)
}
func downloadToFileLimited(path, output string, overwrite bool, maxBytes int64, cfg config) (err error) {
	if !overwrite {
		if _, statErr := os.Stat(output); statErr == nil {
			return errors.New("output file already exists; use --overwrite to replace it")
		} else if !os.IsNotExist(statErr) {
			return statErr
		}
	}
	directory := filepath.Dir(output)
	file, err := os.CreateTemp(directory, "."+filepath.Base(output)+".partial-*")
	if err != nil {
		return err
	}
	temporary := file.Name()
	published := false
	defer func() {
		_ = file.Close()
		if !published {
			_ = os.Remove(temporary)
		}
	}()
	req, err := http.NewRequest("GET", endpoint(cfg.Server, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("User-Agent", "paasta-cli/"+version)
	response, err := (&http.Client{Timeout: 30 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		var problem apiError
		_ = json.Unmarshal(data, &problem)
		if problem.Message != "" {
			return errors.New(problem.Message)
		}
		if problem.Error != "" {
			return errors.New(problem.Error)
		}
		return fmt.Errorf("download failed: HTTP %d", response.StatusCode)
	}
	reader := io.Reader(response.Body)
	if maxBytes > 0 {
		reader = io.LimitReader(response.Body, maxBytes+1)
	}
	written, copyErr := io.Copy(file, reader)
	if copyErr != nil {
		return copyErr
	}
	if maxBytes > 0 && written > maxBytes {
		return fmt.Errorf("download exceeds the %d-byte safety limit", maxBytes)
	}
	if err = file.Close(); err != nil {
		return err
	}
	if !overwrite {
		if _, statErr := os.Stat(output); statErr == nil {
			return errors.New("output file was created during download; use --overwrite to replace it")
		}
	}
	if overwrite {
		if removeErr := os.Remove(output); removeErr != nil && !os.IsNotExist(removeErr) {
			return removeErr
		}
	}
	if err = os.Rename(temporary, output); err != nil {
		return err
	}
	published = true
	success("Downloaded " + output)
	return nil
}

type volumeFileItem struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	IsDir    bool   `json:"isDir"`
	IsLink   bool   `json:"isSymlink"`
	Modified string `json:"modified"`
}

type volumeFilesResult struct {
	Path  string           `json:"path"`
	Items []volumeFileItem `json:"items"`
}

func safeVolumePath(value string, allowRoot bool) (string, error) {
	if value == "" || len(value) > 1024 || !strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\\\x00") {
		return "", errors.New("remote path must be an absolute POSIX path")
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." {
			return "", errors.New("remote path cannot contain ..")
		}
	}
	cleaned := pathpkg.Clean(value)
	if !allowRoot && cleaned == "/" {
		return "", errors.New("remote path cannot be the volume root")
	}
	return cleaned, nil
}

func volumeFilesPath(id, remotePath string, extra url.Values) string {
	query := url.Values{"path": []string{remotePath}}
	for key, values := range extra {
		query[key] = values
	}
	return "/api/volumes/" + url.PathEscape(id) + "/files?" + query.Encode()
}

func listVolumeFiles(id, remotePath string, jsonOutput bool, cfg config) error {
	remotePath, err := safeVolumePath(remotePath, true)
	if err != nil {
		return err
	}
	var result volumeFilesResult
	if err = api("GET", volumeFilesPath(id, remotePath, nil), nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Items) == 0 {
		fmt.Println("No files found.")
		return nil
	}
	for _, item := range result.Items {
		kind := "file"
		if item.IsDir {
			kind = "dir"
		} else if item.IsLink {
			kind = "link"
		}
		fmt.Printf("%-5s %10d  %s\n", kind, item.Size, item.Path)
	}
	return nil
}

func uploadVolumeFile(id, localPath, remotePath string, overwrite bool, cfg config) error {
	remotePath, err := safeVolumePath(remotePath, false)
	if err != nil {
		return err
	}
	file, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("local path must be a regular file")
	}
	tusPath := "/api/volumes/" + url.PathEscape(id) + "/files/tus"
	for _, part := range strings.Split(strings.TrimPrefix(remotePath, "/"), "/") {
		tusPath += "/" + url.PathEscape(part)
	}
	if overwrite {
		tusPath += "?overwrite=1"
	}
	req, err := http.NewRequest("POST", endpoint(cfg.Server, tusPath), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Tus-Resumable", "1.0.0")
	req.Header.Set("Upload-Length", strconv.FormatInt(info.Size(), 10))
	req.Header.Set("Upload-Metadata", "filename "+base64.RawStdEncoding.EncodeToString([]byte(filepath.Base(localPath))))
	req.Header.Set("User-Agent", "paasta-cli/"+version)
	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	_ = response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return apiResponseError(data, response.StatusCode, "upload creation failed")
	}
	location := response.Header.Get("Location")
	if location == "" {
		return errors.New("upload server did not return a resumable location")
	}
	locationURL, err := url.Parse(location)
	if err != nil {
		return err
	}
	if !locationURL.IsAbs() {
		base, parseErr := url.Parse(cfg.Server)
		if parseErr != nil {
			return parseErr
		}
		location = base.ResolveReference(locationURL).String()
	}
	offset := int64(0)
	if rawOffset := response.Header.Get("Upload-Offset"); rawOffset != "" {
		offset, err = strconv.ParseInt(rawOffset, 10, 64)
		if err != nil || offset < 0 || offset > info.Size() {
			return errors.New("upload server returned an invalid offset")
		}
	}
	buffer := make([]byte, tusChunkBytes)
	for offset < info.Size() {
		if _, err = file.Seek(offset, io.SeekStart); err != nil {
			return err
		}
		remaining := info.Size() - offset
		length := int64(len(buffer))
		if remaining < length {
			length = remaining
		}
		read, readErr := io.ReadFull(file, buffer[:length])
		if readErr != nil && readErr != io.ErrUnexpectedEOF {
			return readErr
		}
		var patchErr error
		for attempt := 0; attempt < 6; attempt++ {
			patch, requestErr := http.NewRequest("PATCH", location, bytes.NewReader(buffer[:read]))
			if requestErr != nil {
				return requestErr
			}
			patch.ContentLength = int64(read)
			patch.Header.Set("Authorization", "Bearer "+cfg.Token)
			patch.Header.Set("Tus-Resumable", "1.0.0")
			patch.Header.Set("Upload-Offset", strconv.FormatInt(offset, 10))
			patch.Header.Set("Content-Type", "application/offset+octet-stream")
			patch.Header.Set("User-Agent", "paasta-cli/"+version)
			patched, doErr := client.Do(patch)
			if doErr == nil {
				body, _ := io.ReadAll(io.LimitReader(patched.Body, 64*1024))
				_ = patched.Body.Close()
				if patched.StatusCode >= 200 && patched.StatusCode < 300 {
					offset, patchErr = strconv.ParseInt(patched.Header.Get("Upload-Offset"), 10, 64)
					if patchErr == nil {
						break
					}
				} else if patched.StatusCode == http.StatusConflict {
					recovered, recoverErr := strconv.ParseInt(patched.Header.Get("Upload-Offset"), 10, 64)
					if recoverErr == nil && recovered > offset && recovered <= info.Size() {
						offset, patchErr = recovered, nil
						break
					}
					patchErr = apiResponseError(body, patched.StatusCode, "upload chunk failed")
				} else {
					patchErr = apiResponseError(body, patched.StatusCode, "upload chunk failed")
				}
			} else {
				patchErr = doErr
			}
			time.Sleep(time.Duration(attempt+1) * time.Second)
		}
		if patchErr != nil {
			return fmt.Errorf("upload paused at %d bytes: %w; run the same command to resume", offset, patchErr)
		}
		fmt.Fprintf(os.Stderr, "\rUploaded %3d%%", offset*100/info.Size())
	}
	if info.Size() > 0 {
		fmt.Fprintln(os.Stderr)
	}
	success("File uploaded to " + remotePath)
	return nil
}

func apiResponseError(data []byte, status int, fallback string) error {
	var problem apiError
	_ = json.Unmarshal(data, &problem)
	if problem.Message != "" {
		return errors.New(problem.Message)
	}
	if problem.Error != "" {
		return errors.New(problem.Error)
	}
	return fmt.Errorf("%s: HTTP %d", fallback, status)
}

func volumeOperation(id, operation, source, destination string, cfg config) error {
	source, err := safeVolumePath(source, false)
	if err != nil {
		return err
	}
	destination, err = safeVolumePath(destination, operation == "extract")
	if err != nil {
		return err
	}
	keyBytes := make([]byte, 16)
	if _, err = rand.Read(keyBytes); err != nil {
		return err
	}
	payload := map[string]string{"action": operation, "path": source, "destination": destination, "operationKey": fmt.Sprintf("cli-%x", keyBytes)}
	var started struct {
		OperationID string `json:"operationId"`
	}
	if err = api("POST", volumeFilesPath(id, source, nil), payload, &started, cfg); err != nil {
		return err
	}
	if started.OperationID == "" {
		return errors.New("operation server did not return an operation ID")
	}
	deadline := time.Now().Add(30 * time.Minute)
	for time.Now().Before(deadline) {
		time.Sleep(1500 * time.Millisecond)
		var state struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		}
		query := url.Values{"operation": []string{started.OperationID}}
		if err = api("GET", "/api/volumes/"+url.PathEscape(id)+"/files?"+query.Encode(), nil, &state, cfg); err != nil {
			return err
		}
		if state.Status == "succeeded" {
			success("Volume file operation completed")
			return nil
		}
		if state.Status == "failed" {
			if state.Error != "" {
				return errors.New(state.Error)
			}
			return errors.New("volume file operation failed")
		}
	}
	return errors.New("volume file operation exceeded 30 minutes; inspect the destination before retrying")
}

func volumeFileCommand(command args, cfg config) error {
	if len(command.Positionals) < 1 {
		return errors.New("use: paasta volume file download|upload|copy|zip|extract|mkdir|rename|delete")
	}
	operation := command.Positionals[0]
	if operation == "download" {
		if len(command.Positionals) != 3 || command.Flags["output"] == "" {
			return errors.New("use: paasta volume file download ID REMOTE_PATH --output FILE [--overwrite]")
		}
		remotePath, err := safeVolumePath(command.Positionals[2], false)
		if err != nil {
			return err
		}
		return downloadToFile(volumeFilesPath(command.Positionals[1], remotePath, url.Values{"download": []string{"1"}}), command.Flags["output"], command.Flags["overwrite"] == "true", cfg)
	}
	if command.Flags["yes"] != "true" {
		return fmt.Errorf("volume file %s requires --yes; review the destination and rerun the command with --yes", operation)
	}
	if operation == "upload" {
		if len(command.Positionals) != 3 || command.Flags["path"] == "" {
			return errors.New("use: paasta volume file upload ID LOCAL_FILE --path REMOTE_PATH [--overwrite] --yes")
		}
		return uploadVolumeFile(command.Positionals[1], command.Positionals[2], command.Flags["path"], command.Flags["overwrite"] == "true", cfg)
	}
	if operation == "mkdir" && len(command.Positionals) == 3 {
		remotePath, err := safeVolumePath(command.Positionals[2], false)
		if err != nil {
			return err
		}
		return action("POST", volumeFilesPath(command.Positionals[1], remotePath, nil), map[string]string{"action": "folder", "path": remotePath}, cfg)
	}
	if (operation == "copy" || operation == "zip" || operation == "extract") && len(command.Positionals) == 4 {
		return volumeOperation(command.Positionals[1], operation, command.Positionals[2], command.Positionals[3], cfg)
	}
	if operation == "rename" && len(command.Positionals) == 4 {
		source, err := safeVolumePath(command.Positionals[2], false)
		if err != nil {
			return err
		}
		destination, err := safeVolumePath(command.Positionals[3], false)
		if err != nil {
			return err
		}
		return action("POST", volumeFilesPath(command.Positionals[1], source, nil), map[string]string{"action": "rename", "path": source, "destination": destination}, cfg)
	}
	if operation == "delete" && len(command.Positionals) == 3 {
		remotePath, err := safeVolumePath(command.Positionals[2], false)
		if err != nil {
			return err
		}
		return action("DELETE", volumeFilesPath(command.Positionals[1], remotePath, nil), nil, cfg)
	}
	return errors.New("use: paasta volume file upload|copy|zip|extract|mkdir|rename|delete ... --yes")
}
func databaseBackups(id string, cfg config, jsonOutput bool) error {
	var result struct {
		Backups []databaseBackupView `json:"backups"`
	}
	if err := api("GET", "/api/databases/"+url.PathEscape(id)+"/backups", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Backups) == 0 {
		fmt.Println("No database backups found.")
		return nil
	}
	for _, item := range result.Backups {
		fmt.Printf("%-12s restore=%-10s verify=%-10s %s\n", item.Status, item.RestoreStatus, item.VerificationStatus, item.ID)
	}
	return nil
}
func databaseAccess(id string, cfg config, jsonOutput bool) error {
	var result databaseAccessResult
	if err := api("GET", "/api/databases/"+url.PathEscape(id)+"/access", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Credentials) == 0 {
		fmt.Println("No database credentials found.")
		return nil
	}
	for _, credential := range result.Credentials {
		primary := ""
		if credential.IsPrimary {
			primary = " primary"
		}
		fmt.Printf("%-12s %-20s %-20s%s\n", credential.Status, credential.DatabaseName, credential.Username, primary)
		for _, connection := range credential.Connections {
			fmt.Printf("  -> %-20s %-20s %s\n", connection.Project, connection.EnvironmentKey, connection.ID)
		}
		fmt.Printf("  id: %s\n", credential.ID)
	}
	return nil
}

func printCredentialMutation(result databaseCredentialMutation, showSecret bool) error {
	if showSecret {
		return printJSON(result)
	}
	result.Connection = nil
	if result.CredentialID != "" {
		fmt.Println("Credential:", result.CredentialID)
	}
	if result.ConnectionID != "" {
		fmt.Println("Connection:", result.ConnectionID, result.Environment)
	}
	success("Done. Credentials were hidden; use an explicit reveal command with --show-secret when needed.")
	return nil
}

func databaseCredentialCommand(command args, cfg config) error {
	if len(command.Positionals) < 2 {
		return errors.New("use: paasta database credential create|reveal|rotate|delete DATABASE_ID ...")
	}
	operation, databaseID := command.Positionals[0], command.Positionals[1]
	path := "/api/databases/" + url.PathEscape(databaseID) + "/access"
	if operation == "create" {
		if len(command.Positionals) != 2 || command.Flags["database"] == "" || command.Flags["username"] == "" || command.Flags["yes"] != "true" {
			return errors.New("use: paasta database credential create DATABASE_ID --database NAME --username NAME --yes [--show-secret]")
		}
		var result databaseCredentialMutation
		if err := api("POST", path, map[string]string{"action": "create", "database_name": command.Flags["database"], "username": command.Flags["username"]}, &result, cfg); err != nil {
			return err
		}
		return printCredentialMutation(result, command.Flags["show-secret"] == "true")
	}
	if len(command.Positionals) != 3 {
		return errors.New("credential id is required")
	}
	credentialID := command.Positionals[2]
	if operation == "reveal" {
		if command.Flags["show-secret"] != "true" {
			return errors.New("credential reveal requires --show-secret")
		}
		var result databaseCredentialMutation
		if err := api("POST", path, map[string]string{"action": "reveal", "credential_id": credentialID}, &result, cfg); err != nil {
			return err
		}
		return printCredentialMutation(result, true)
	}
	if operation == "rotate" {
		if command.Flags["yes"] != "true" {
			return errors.New("credential rotation requires --yes")
		}
		var result databaseCredentialMutation
		if err := api("POST", path, map[string]string{"action": "rotate", "credential_id": credentialID}, &result, cfg); err != nil {
			return err
		}
		return printCredentialMutation(result, command.Flags["show-secret"] == "true")
	}
	if operation == "delete" && command.Flags["yes"] == "true" {
		return action("DELETE", path, map[string]string{"credential_id": credentialID}, cfg)
	}
	return errors.New("use: paasta database credential reveal ... --show-secret | rotate|delete ... --yes")
}

func databaseConnectionCommand(command args, cfg config) error {
	if len(command.Positionals) < 3 || command.Flags["yes"] != "true" {
		return errors.New("use: paasta database connection create|delete DATABASE_ID ID --yes")
	}
	operation, databaseID, targetID := command.Positionals[0], command.Positionals[1], command.Positionals[2]
	path := "/api/databases/" + url.PathEscape(databaseID) + "/access"
	if operation == "delete" && len(command.Positionals) == 3 {
		return action("DELETE", path, map[string]string{"connection_id": targetID}, cfg)
	}
	if operation != "create" || len(command.Positionals) != 3 || command.Flags["project"] == "" {
		return errors.New("use: paasta database connection create DATABASE_ID CREDENTIAL_ID --project PROJECT_ID [--key NAME_URL] [--primary true|false] --yes")
	}
	payload := map[string]any{"action": "connect", "credential_id": targetID, "project_id": command.Flags["project"]}
	if _, exists := command.Flags["primary"]; exists {
		primary, err := flagBool(command.Flags, "primary", false)
		if err != nil {
			return err
		}
		payload["primary"] = primary
	}
	if command.Flags["key"] != "" {
		payload["environment_key"] = command.Flags["key"]
	}
	var result databaseCredentialMutation
	if err := api("POST", path, payload, &result, cfg); err != nil {
		return err
	}
	return printCredentialMutation(result, false)
}
func databaseCommand(command args, cfg config) error {
	if len(command.Positionals) < 1 {
		return errors.New("use: paasta database create|info|access|credential|connection|backups|backup|policy|pitr|recover|delete")
	}
	operation := command.Positionals[0]
	if operation == "access" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta database access DATABASE_ID [--json]")
		}
		return databaseAccess(command.Positionals[1], cfg, command.Flags["json"] == "true")
	}
	if operation == "credential" {
		command.Positionals = command.Positionals[1:]
		return databaseCredentialCommand(command, cfg)
	}
	if operation == "connection" {
		command.Positionals = command.Positionals[1:]
		return databaseConnectionCommand(command, cfg)
	}
	if operation == "info" {
		if len(command.Positionals) != 2 {
			return errors.New("database id is required")
		}
		var result any
		if err := api("GET", "/api/databases/"+url.PathEscape(command.Positionals[1]), nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if operation == "backups" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta database backups DATABASE_ID [--json]")
		}
		return databaseBackups(command.Positionals[1], cfg, command.Flags["json"] == "true")
	}
	if operation == "backup" {
		if len(command.Positionals) == 2 {
			return action("POST", "/api/databases/"+url.PathEscape(command.Positionals[1])+"/backups", nil, cfg)
		}
		if len(command.Positionals) != 4 {
			return errors.New("use: paasta database backup download|verify|restore|delete DATABASE_ID BACKUP_ID")
		}
		subcommand, databaseID, backupID := command.Positionals[1], command.Positionals[2], command.Positionals[3]
		path := "/api/databases/" + url.PathEscape(databaseID) + "/backups/" + url.PathEscape(backupID)
		if subcommand == "download" {
			if command.Flags["output"] == "" {
				return errors.New("use: paasta database backup download DATABASE_ID BACKUP_ID --output FILE [--overwrite]")
			}
			return downloadToFile(path, command.Flags["output"], command.Flags["overwrite"] == "true", cfg)
		}
		if subcommand == "verify" {
			return action("POST", path+"/verify", nil, cfg)
		}
		if (subcommand != "restore" && subcommand != "delete") || command.Flags["yes"] != "true" {
			return errors.New("database backup restore/delete requires --yes")
		}
		method, suffix := "DELETE", ""
		if subcommand == "restore" {
			method, suffix = "POST", "/restore"
		}
		return action(method, path+suffix, nil, cfg)
	}
	if operation == "policy" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta database policy DATABASE_ID --schedule manual|hourly|daily|weekly --retention COUNT")
		}
		schedule := command.Flags["schedule"]
		if !map[string]bool{"manual": true, "hourly": true, "daily": true, "weekly": true}[schedule] {
			return errors.New("schedule must be manual, hourly, daily, or weekly")
		}
		retention, parseErr := strconv.Atoi(command.Flags["retention"])
		if parseErr != nil || retention < 1 {
			return errors.New("retention must be a positive number")
		}
		return action("PATCH", "/api/databases/"+url.PathEscape(command.Positionals[1]), map[string]any{"action": "backup-policy", "backup_schedule": schedule, "backup_retention_count": retention}, cfg)
	}
	if operation == "pitr" {
		if len(command.Positionals) != 3 || (command.Positionals[1] != "enable" && command.Positionals[1] != "disable") || command.Flags["yes"] != "true" {
			return errors.New("use: paasta database pitr enable|disable DATABASE_ID --yes")
		}
		return action("PATCH", "/api/databases/"+url.PathEscape(command.Positionals[2]), map[string]any{"action": "pitr", "enabled": command.Positionals[1] == "enable"}, cfg)
	}
	if operation == "recover" {
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" || command.Flags["at"] == "" {
			return errors.New("use: paasta database recover DATABASE_ID --at RFC3339 --yes")
		}
		target, parseErr := time.Parse(time.RFC3339, command.Flags["at"])
		if parseErr != nil || target.After(time.Now().Add(time.Minute)) {
			return errors.New("--at must be a valid RFC3339 time that is not in the future")
		}
		return action("POST", "/api/databases/"+url.PathEscape(command.Positionals[1])+"/recovery", map[string]string{"target_at": target.Format(time.RFC3339)}, cfg)
	}
	if operation == "delete" {
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta database delete ID --yes")
		}
		return action("DELETE", "/api/databases/"+url.PathEscape(command.Positionals[1]), nil, cfg)
	}
	if operation != "create" || len(command.Positionals) != 2 {
		return errors.New("use: paasta database create PROJECT --name NAME --plan ID --storage ID --size GB [--billing payg|monthly]")
	}
	payload := map[string]any{"project": slug(command.Positionals[1]), "name": command.Flags["name"], "plan_id": command.Flags["plan"], "storage_offering_id": command.Flags["storage"], "size_gb": command.Flags["size"], "billing_mode": value(command.Flags, "billing", "payg")}
	return action("POST", "/api/databases", payload, cfg)
}
func notifications(cfg config, jsonOutput bool) error {
	var result notificationsResult
	if err := api("GET", "/api/notifications", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	fmt.Printf("Channels: %d  Recent deliveries: %d\n", len(result.Channels), len(result.Deliveries))
	for _, channel := range result.Channels {
		state := "disabled"
		if channel.Enabled {
			state = "enabled"
		}
		target := ""
		if channel.Destination != nil {
			target = *channel.Destination
		} else if channel.URL != nil {
			target = *channel.URL
		}
		fmt.Printf("%-9s %-9s %-20s %-30s %s\n", state, channel.Kind, channel.Name, target, channel.ID)
	}
	fmt.Println("Preferences:")
	for _, preference := range result.Preferences {
		fmt.Printf("%-12s email=%-5t sms=%-5t\n", preference.Kind, preference.Email, preference.SMS)
	}
	return nil
}

func webhookSecret(path string) (string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 {
		return "", errors.New("webhook secret file must be a regular file smaller than 4 KiB")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return "", errors.New("webhook secret file permissions are too open; use chmod 600")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	secret := strings.TrimRight(string(data), "\r\n")
	if len(secret) < 16 || len(secret) > 200 {
		return "", errors.New("webhook secret must be between 16 and 200 characters")
	}
	return secret, nil
}

func notificationCommand(command args, cfg config) error {
	if len(command.Positionals) < 2 {
		return errors.New("use: paasta notification preference|channel ...")
	}
	group, operation := command.Positionals[0], command.Positionals[1]
	if group == "preference" && operation == "set" {
		if len(command.Positionals) != 3 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta notification preference set KIND [--email true|false] [--sms true|false] --yes")
		}
		if _, emailSet := command.Flags["email"]; !emailSet {
			if _, smsSet := command.Flags["sms"]; !smsSet {
				return errors.New("set --email, --sms, or both")
			}
		}
		payload := map[string]any{"kind": command.Positionals[2]}
		for _, name := range []string{"email", "sms"} {
			if _, exists := command.Flags[name]; exists {
				enabled, err := flagBool(command.Flags, name, false)
				if err != nil {
					return err
				}
				payload[name] = enabled
			}
		}
		return action("PATCH", "/api/notifications/preferences", payload, cfg)
	}
	if group != "channel" || command.Flags["yes"] != "true" {
		return errors.New("notification channel mutations require --yes")
	}
	if operation == "create" {
		kind, name := command.Flags["kind"], command.Flags["name"]
		if len(command.Positionals) != 2 || name == "" || !map[string]bool{"email": true, "sms": true, "webhook": true}[kind] {
			return errors.New("use: paasta notification channel create --name NAME --kind email|sms|webhook ... --yes")
		}
		payload := map[string]any{"name": name, "kind": kind}
		if kind == "webhook" {
			if command.Flags["url"] == "" || command.Flags["secret-file"] == "" {
				return errors.New("webhook requires --url HTTPS_URL and --secret-file FILE")
			}
			secret, err := webhookSecret(command.Flags["secret-file"])
			if err != nil {
				return err
			}
			payload["url"], payload["secret"] = command.Flags["url"], secret
		} else {
			if command.Flags["destination"] == "" {
				return errors.New("email and sms channels require --destination")
			}
			payload["destination"] = command.Flags["destination"]
		}
		return action("POST", "/api/notifications", payload, cfg)
	}
	if len(command.Positionals) != 3 {
		return errors.New("channel id is required")
	}
	id := command.Positionals[2]
	path := "/api/notifications/" + url.PathEscape(id)
	switch operation {
	case "enable", "disable":
		return action("PATCH", path, map[string]bool{"enabled": operation == "enable"}, cfg)
	case "test":
		return action("POST", path, nil, cfg)
	case "delete":
		return action("DELETE", path, nil, cfg)
	default:
		return errors.New("use: paasta notification channel create|enable|disable|test|delete")
	}
}

func readJSONFile(path string, output any) error {
	if path == "" {
		return errors.New("--file is required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 128*1024 {
		return errors.New("JSON input must be a regular file no larger than 128 KiB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(output); err != nil {
		return fmt.Errorf("invalid JSON input: %w", err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("JSON input must contain exactly one value")
	}
	return nil
}

func cdnInventory(cfg config) (cdnInventoryResult, error) {
	var result cdnInventoryResult
	err := api("GET", "/api/cdn/sites", nil, &result, cfg)
	return result, err
}

func cdnMutation(method, path string, payload any, jsonOutput bool, cfg config) error {
	var result any
	if err := api(method, path, payload, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	success("Done")
	return nil
}

func cdnCommand(command args, cfg config) error {
	if len(command.Positionals) == 0 {
		return errors.New("use: paasta cdn sites|plans|site|scan|create|cancel|renew|delete|plan|records|record|origin|purge|feature|firewall")
	}
	op, jsonOutput := command.Positionals[0], command.Flags["json"] == "true"
	switch op {
	case "sites", "plans":
		if len(command.Positionals) != 1 {
			return fmt.Errorf("use: paasta cdn %s [--json]", op)
		}
		inventory, err := cdnInventory(cfg)
		if err != nil {
			return err
		}
		if jsonOutput {
			if op == "plans" {
				return printJSON(map[string]any{"plans": inventory.Plans})
			}
			return printJSON(map[string]any{"sites": inventory.Sites, "nameservers": inventory.Nameservers})
		}
		if op == "plans" {
			for _, plan := range inventory.Plans {
				fmt.Printf("%-18s %-20s %s toman/month · %d GiB\n", plan.ID, plan.Name, plan.MonthlyPrice, plan.TrafficGB)
			}
			return nil
		}
		if len(inventory.Sites) == 0 {
			fmt.Println("No CDN sites found.")
			return nil
		}
		for _, site := range inventory.Sites {
			fmt.Printf("%-32s %-14s %-18s %s\n", site.Domain, site.Status, site.PlanName, site.ID)
		}
		return nil
	case "site":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta cdn site ID [--json]")
		}
		var result any
		if err := api("GET", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1]), nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	case "scan":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta cdn scan DOMAIN [--json]")
		}
		var result any
		if err := api("POST", "/api/cdn/scan", map[string]string{"domain": command.Positionals[1]}, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	case "create":
		if len(command.Positionals) != 2 || command.Flags["origin"] == "" || command.Flags["plan"] == "" {
			return errors.New("use: paasta cdn create DOMAIN --origin HOST --scheme http|https --plan ID [--records-file FILE] [--managed-domain ID] --yes [--json]")
		}
		inventory, err := cdnInventory(cfg)
		if err != nil {
			return err
		}
		var selected *cdnPlanView
		for index := range inventory.Plans {
			if inventory.Plans[index].ID == command.Flags["plan"] {
				selected = &inventory.Plans[index]
				break
			}
		}
		if selected == nil {
			return errors.New("CDN plan not found")
		}
		fmt.Printf("Monthly charge: %s toman · %d GiB traffic\n", selected.MonthlyPrice, selected.TrafficGB)
		if command.Flags["yes"] != "true" {
			return errors.New("CDN creation requires --yes after reviewing the monthly charge")
		}
		scheme := value(command.Flags, "scheme", "https")
		if scheme != "http" && scheme != "https" {
			return errors.New("--scheme must be http or https")
		}
		records := []map[string]any{}
		if command.Flags["records-file"] != "" {
			if err := readJSONFile(command.Flags["records-file"], &records); err != nil {
				return err
			}
		}
		payload := map[string]any{"domain": command.Positionals[1], "origin": command.Flags["origin"], "scheme": scheme, "planId": command.Flags["plan"], "records": records}
		if command.Flags["managed-domain"] != "" {
			payload["managedDomainId"] = command.Flags["managed-domain"]
		}
		return cdnMutation("POST", "/api/cdn/sites", payload, jsonOutput, cfg)
	case "cancel", "renew", "delete":
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return fmt.Errorf("use: paasta cdn %s ID --yes [--json]", op)
		}
		method, suffix := "DELETE", ""
		if op == "renew" {
			method = "PATCH"
		} else if op == "delete" {
			suffix = "?immediate=1"
		}
		return cdnMutation(method, "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+suffix, nil, jsonOutput, cfg)
	case "plan":
		if len(command.Positionals) != 2 || command.Flags["plan"] == "" {
			return errors.New("use: paasta cdn plan ID --plan PLAN_ID --yes [--json]")
		}
		inventory, err := cdnInventory(cfg)
		if err != nil {
			return err
		}
		var current *cdnSiteView
		var selected *cdnPlanView
		for index := range inventory.Sites {
			if inventory.Sites[index].ID == command.Positionals[1] {
				current = &inventory.Sites[index]
			}
		}
		for index := range inventory.Plans {
			if inventory.Plans[index].ID == command.Flags["plan"] {
				selected = &inventory.Plans[index]
			}
		}
		if current == nil || selected == nil {
			return errors.New("CDN site or plan not found")
		}
		currentPrice, _ := strconv.ParseInt(current.MonthlyPrice, 10, 64)
		nextPrice, _ := strconv.ParseInt(selected.MonthlyPrice, 10, 64)
		charge := max(int64(0), nextPrice-currentPrice)
		if periodEnd, parseErr := time.Parse(time.RFC3339, current.PeriodEnd); parseErr == nil && !periodEnd.After(time.Now()) {
			charge = nextPrice
		}
		fmt.Printf("Maximum immediate charge: %d toman · next renewal: %s toman/month\n", charge, selected.MonthlyPrice)
		if command.Flags["yes"] != "true" {
			return errors.New("CDN plan upgrade requires --yes after reviewing the charge")
		}
		return cdnMutation("PUT", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/plan", map[string]string{"planId": command.Flags["plan"]}, jsonOutput, cfg)
	case "records":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta cdn records ID [--json]")
		}
		var result any
		if err := api("GET", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/records", nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	case "record":
		if len(command.Positionals) != 3 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta cdn record add|update|delete ID [record flags] --yes [--json]")
		}
		actionName, siteID := command.Positionals[1], command.Positionals[2]
		path := "/api/cdn/sites/" + url.PathEscape(siteID) + "/records"
		if actionName == "delete" {
			if command.Flags["id"] == "" {
				return errors.New("record deletion requires --id")
			}
			return cdnMutation("DELETE", path, map[string]string{"id": command.Flags["id"]}, jsonOutput, cfg)
		}
		if actionName != "add" && actionName != "update" {
			return errors.New("record action must be add, update, or delete")
		}
		if command.Flags["name"] == "" || command.Flags["type"] == "" || command.Flags["value"] == "" {
			return errors.New("record add/update requires --name, --type, and --value")
		}
		ttl, err := strconv.Atoi(value(command.Flags, "ttl", "300"))
		if err != nil {
			return errors.New("--ttl must be an integer")
		}
		proxied, err := flagBool(command.Flags, "cdn", false)
		if err != nil {
			return err
		}
		payload := map[string]any{"name": command.Flags["name"], "type": strings.ToUpper(command.Flags["type"]), "value": command.Flags["value"], "ttl": ttl, "cdn": proxied}
		method := "POST"
		if actionName == "update" {
			if command.Flags["id"] == "" {
				return errors.New("record update requires --id")
			}
			method, payload["id"] = "PATCH", command.Flags["id"]
		}
		return cdnMutation(method, path, payload, jsonOutput, cfg)
	case "origin":
		if len(command.Positionals) == 2 {
			var result any
			if err := api("GET", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/origin", nil, &result, cfg); err != nil {
				return err
			}
			return printJSON(result)
		}
		if len(command.Positionals) != 3 || command.Positionals[1] != "set" || command.Flags["yes"] != "true" {
			return errors.New("use: paasta cdn origin ID [--json] | origin set ID --file JSON --yes [--json]")
		}
		var payload map[string]any
		if err := readJSONFile(command.Flags["file"], &payload); err != nil {
			return err
		}
		return cdnMutation("PATCH", "/api/cdn/sites/"+url.PathEscape(command.Positionals[2])+"/origin", payload, jsonOutput, cfg)
	case "purge":
		if len(command.Positionals) != 2 || command.Flags["paths"] == "" || command.Flags["yes"] != "true" {
			return errors.New("use: paasta cdn purge ID --paths /,/assets/* --yes [--json]")
		}
		paths := strings.Split(command.Flags["paths"], ",")
		return cdnMutation("POST", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/actions", map[string]any{"action": "purge", "paths": paths}, jsonOutput, cfg)
	case "feature":
		if len(command.Positionals) != 2 || command.Flags["name"] == "" || command.Flags["yes"] != "true" {
			return errors.New("use: paasta cdn feature ID --name tls|waf|developer_mode --enabled true|false --yes [--json]")
		}
		if _, exists := command.Flags["enabled"]; !exists {
			return errors.New("CDN feature change requires --enabled true|false")
		}
		name := command.Flags["name"]
		if name != "tls" && name != "waf" && name != "developer_mode" {
			return errors.New("--name must be tls, waf, or developer_mode")
		}
		enabled, err := flagBool(command.Flags, "enabled", false)
		if err != nil {
			return err
		}
		return cdnMutation("POST", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/actions", map[string]any{"action": name, "value": enabled}, jsonOutput, cfg)
	case "firewall":
		return cdnFirewallCommand(command, cfg)
	default:
		return errors.New("unknown CDN command")
	}
}

func cdnFirewallCommand(command args, cfg config) error {
	jsonOutput := command.Flags["json"] == "true"
	if len(command.Positionals) == 2 {
		var result any
		if err := api("GET", "/api/cdn/sites/"+url.PathEscape(command.Positionals[1])+"/firewall", nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if len(command.Positionals) != 3 || command.Flags["yes"] != "true" {
		return errors.New("use: paasta cdn firewall ID | firewall add|update|toggle|move|delete ID ... --yes [--json]")
	}
	op, siteID := command.Positionals[1], command.Positionals[2]
	path := "/api/cdn/sites/" + url.PathEscape(siteID) + "/firewall"
	switch op {
	case "add", "update":
		var payload map[string]any
		if err := readJSONFile(command.Flags["file"], &payload); err != nil {
			return err
		}
		method := "POST"
		if op == "update" {
			if command.Flags["id"] == "" {
				return errors.New("firewall update requires --id")
			}
			method, payload["id"] = "PUT", command.Flags["id"]
		}
		return cdnMutation(method, path, payload, jsonOutput, cfg)
	case "toggle":
		if command.Flags["id"] == "" {
			return errors.New("firewall toggle requires --id")
		}
		if _, exists := command.Flags["enabled"]; !exists {
			return errors.New("firewall toggle requires --enabled true|false")
		}
		enabled, err := flagBool(command.Flags, "enabled", false)
		if err != nil {
			return err
		}
		return cdnMutation("PATCH", path, map[string]any{"id": command.Flags["id"], "enabled": enabled}, jsonOutput, cfg)
	case "move":
		if command.Flags["id"] == "" || (command.Flags["direction"] != "up" && command.Flags["direction"] != "down") {
			return errors.New("firewall move requires --id and --direction up|down")
		}
		return cdnMutation("PATCH", path, map[string]any{"id": command.Flags["id"], "operation": "move", "direction": command.Flags["direction"]}, jsonOutput, cfg)
	case "delete":
		if command.Flags["id"] == "" {
			return errors.New("firewall deletion requires --id")
		}
		return cdnMutation("DELETE", path, map[string]string{"id": command.Flags["id"]}, jsonOutput, cfg)
	default:
		return errors.New("firewall action must be add, update, toggle, move, or delete")
	}
}

func readSupportBody(path string) (string, error) {
	if path == "" {
		return "", errors.New("--body-file is required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > 40*1024 {
		return "", errors.New("--body-file must be a regular file containing at most 10,000 characters")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	body := strings.TrimSpace(string(data))
	if length := len([]rune(body)); length == 0 || length > 10000 {
		return "", errors.New("support message must contain 1 to 10,000 characters")
	}
	return body, nil
}

func readSupportAttachment(path string) ([]byte, string, string, error) {
	if path == "" {
		return nil, "", "", nil
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, "", "", err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxSupportAttachmentBytes {
		return nil, "", "", errors.New("--attachment must be a regular file between 1 byte and 5 MiB")
	}
	extension := strings.ToLower(filepath.Ext(path))
	contentTypes := map[string]string{
		".txt": "text/plain", ".log": "text/plain", ".pdf": "application/pdf", ".zip": "application/zip",
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
	}
	contentType := contentTypes[extension]
	if contentType == "" {
		contentType = mime.TypeByExtension(extension)
	}
	if contentType == "" || !map[string]bool{"text/plain": true, "application/pdf": true, "application/zip": true, "image/png": true, "image/jpeg": true, "image/webp": true}[strings.Split(contentType, ";")[0]] {
		return nil, "", "", errors.New("attachment must be TXT, LOG, PDF, ZIP, PNG, JPEG, or WebP")
	}
	data, err := os.ReadFile(path)
	return data, filepath.Base(path), strings.Split(contentType, ";")[0], err
}

func supportMultipart(path string, fields map[string]string, attachmentPath string, cfg config, output any) error {
	attachment, filename, contentType, err := readSupportAttachment(attachmentPath)
	if err != nil {
		return err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if fields[key] != "" {
			if err = writer.WriteField(key, fields[key]); err != nil {
				return err
			}
		}
	}
	if len(attachment) > 0 {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="attachment"; filename="%s"`, strings.ReplaceAll(filename, `"`, "_")))
		header.Set("Content-Type", contentType)
		part, partErr := writer.CreatePart(header)
		if partErr != nil {
			return partErr
		}
		if _, err = part.Write(attachment); err != nil {
			return err
		}
	}
	if err = writer.Close(); err != nil {
		return err
	}
	response, data, err := requestRaw("POST", endpoint(cfg.Server, path), &body, writer.FormDataContentType(), cfg.Token)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem apiError
		_ = json.Unmarshal(data, &problem)
		if problem.Error != "" {
			return errors.New(problem.Error)
		}
		return fmt.Errorf("support request failed: HTTP %d", response.StatusCode)
	}
	if output != nil && len(data) > 0 {
		return json.Unmarshal(data, output)
	}
	return nil
}

func supportCommand(command args, cfg config) error {
	operation := "tickets"
	if len(command.Positionals) > 0 {
		operation = command.Positionals[0]
	}
	switch operation {
	case "tickets":
		if len(command.Positionals) > 1 {
			return errors.New("use: paasta support tickets [--json]")
		}
		var result supportTicketsResult
		if err := api("GET", "/api/support", nil, &result, cfg); err != nil {
			return err
		}
		if command.Flags["json"] == "true" {
			return printJSON(result)
		}
		if len(result.Tickets) == 0 {
			fmt.Println("No support tickets found.")
			return nil
		}
		for _, ticket := range result.Tickets {
			fmt.Printf("#%-8s %-18s %-12s %s\n", ticket.Number, ticket.Status, ticket.Priority, ticket.Subject)
		}
		return nil
	case "ticket":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta support ticket ID [--json]")
		}
		var result supportTicketResult
		if err := api("GET", "/api/support/"+url.PathEscape(command.Positionals[1]), nil, &result, cfg); err != nil {
			return err
		}
		if command.Flags["json"] == "true" {
			return printJSON(result)
		}
		fmt.Printf("#%s %s [%s/%s]\n%s\n", result.Ticket.Number, result.Ticket.Subject, result.Ticket.Status, result.Ticket.Priority, strings.Repeat("-", 60))
		for _, message := range result.Messages {
			role := "customer"
			if message.Staff {
				role = "Paasta support"
			}
			fmt.Printf("%s (%s) %s\n%s\n", message.SenderName, role, message.CreatedAt, message.Body)
			if message.AttachmentName != nil {
				fmt.Printf("Attachment: %s [message %s]\n", *message.AttachmentName, message.ID)
			}
			fmt.Println(strings.Repeat("-", 60))
		}
		return nil
	case "create":
		if len(command.Positionals) != 1 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta support create --subject TEXT --body-file FILE [--category technical] [--priority normal] [--project NAME] [--attachment FILE] --yes")
		}
		subject := strings.TrimSpace(command.Flags["subject"])
		if length := len([]rune(subject)); length < 5 || length > 150 {
			return errors.New("--subject must contain 5 to 150 characters")
		}
		category, priority := value(command.Flags, "category", "technical"), value(command.Flags, "priority", "normal")
		if !map[string]bool{"technical": true, "billing": true, "account": true, "feedback": true}[category] {
			return errors.New("--category must be technical, billing, account, or feedback")
		}
		if !map[string]bool{"normal": true, "high": true, "urgent": true}[priority] {
			return errors.New("--priority must be normal, high, or urgent")
		}
		body, err := readSupportBody(command.Flags["body-file"])
		if err != nil {
			return err
		}
		var result map[string]any
		if err = supportMultipart("/api/support", map[string]string{"subject": subject, "body": body, "category": category, "priority": priority, "project": command.Flags["project"]}, command.Flags["attachment"], cfg, &result); err != nil {
			return err
		}
		return printJSON(result)
	case "reply":
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta support reply ID --body-file FILE [--attachment FILE] --yes")
		}
		body, err := readSupportBody(command.Flags["body-file"])
		if err != nil {
			return err
		}
		var result map[string]any
		if err = supportMultipart("/api/support/"+url.PathEscape(command.Positionals[1]), map[string]string{"body": body}, command.Flags["attachment"], cfg, &result); err != nil {
			return err
		}
		return printJSON(result)
	case "close":
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta support close ID --yes")
		}
		return action("PATCH", "/api/support/"+url.PathEscape(command.Positionals[1]), map[string]string{"status": "closed"}, cfg)
	case "attachment":
		if len(command.Positionals) != 3 || command.Flags["output"] == "" {
			return errors.New("use: paasta support attachment TICKET_ID MESSAGE_ID --output FILE [--overwrite]")
		}
		path := "/api/support/" + url.PathEscape(command.Positionals[1]) + "/attachments/" + url.PathEscape(command.Positionals[2])
		return downloadToFileLimited(path, command.Flags["output"], command.Flags["overwrite"] == "true", maxSupportAttachmentBytes, cfg)
	default:
		return errors.New("use: paasta support tickets|ticket|create|reply|close|attachment")
	}
}
func deployments(name string, cfg config, jsonOutput bool) error {
	var result struct {
		Deployments []deploymentView `json:"deployments"`
	}
	if err := api("GET", "/api/projects/"+url.PathEscape(slug(name))+"/deployments", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Deployments) == 0 {
		fmt.Println("No deployments found.")
		return nil
	}
	for _, item := range result.Deployments {
		active := ""
		if item.Active {
			active = "production"
		}
		fmt.Printf("%-12s %-12s %-11s %s\n", item.Status, active, item.Trigger, item.ID)
	}
	return nil
}
func buildLogs(id string, cfg config) error {
	response, data, err := requestRaw("GET", endpoint(cfg.Server, "/api/projects/deploy/"+url.PathEscape(id)+"/logs"), nil, "", cfg.Token)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var problem apiError
		_ = json.Unmarshal(data, &problem)
		if problem.Error != "" {
			return errors.New(problem.Error)
		}
		return fmt.Errorf("build logs failed: HTTP %d", response.StatusCode)
	}
	fmt.Print(string(data))
	if len(data) > 0 && !bytes.HasSuffix(data, []byte("\n")) {
		fmt.Println()
	}
	return nil
}
func deploymentCommand(command args, cfg config) error {
	if len(command.Positionals) != 2 {
		return errors.New("use: paasta deployment status|logs|retry BUILD_ID | rollback PROJECT BUILD_ID")
	}
	operation, target := command.Positionals[0], command.Positionals[1]
	if operation == "status" {
		var result any
		if err := api("GET", "/api/projects/deploy/"+url.PathEscape(target), nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if operation == "logs" {
		return buildLogs(target, cfg)
	}
	if operation == "retry" {
		if command.Flags["yes"] != "true" {
			return errors.New("deployment retry requires --yes")
		}
		var result retryView
		if err := api("POST", "/api/projects/deploy/"+url.PathEscape(target)+"/retry", nil, &result, cfg); err != nil {
			return err
		}
		if command.Flags["json"] == "true" {
			return printJSON(result)
		}
		success(fmt.Sprintf("Deployment %s started (%s)", result.ID, result.Status))
		fmt.Printf("Track it with: paasta deployment status %s\n", result.ID)
		return nil
	}
	if operation == "rollback" {
		if command.Flags["yes"] != "true" || command.Flags["build"] == "" {
			return errors.New("use: paasta deployment rollback PROJECT --build BUILD_ID --yes")
		}
		return action("POST", "/api/projects/"+url.PathEscape(slug(target))+"/rollback", map[string]string{"buildId": command.Flags["build"]}, cfg)
	}
	return errors.New("use: paasta deployment status|logs|retry BUILD_ID | rollback PROJECT --build BUILD_ID --yes")
}
func previews(name string, cfg config, jsonOutput bool) error {
	var result struct {
		Previews []previewView `json:"previews"`
	}
	if err := api("GET", "/api/projects/"+url.PathEscape(slug(name))+"/previews", nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	if len(result.Previews) == 0 {
		fmt.Println("No previews found.")
		return nil
	}
	for _, item := range result.Previews {
		fmt.Printf("%-18s %-12s %-28s %s\n", item.Slug, item.Status, item.Domain, item.ID)
	}
	return nil
}
func previewCommand(command args, cfg config) error {
	if len(command.Positionals) < 1 {
		return errors.New("use: paasta preview create|promote|delete")
	}
	operation := command.Positionals[0]
	if operation == "create" {
		if len(command.Positionals) != 3 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta preview create PROJECT SLUG --hours 24 [--build BUILD_ID] --yes")
		}
		hours, err := strconv.Atoi(command.Flags["hours"])
		if err != nil || hours < 1 || hours > 168 {
			return errors.New("--hours must be between 1 and 168")
		}
		payload := map[string]any{"slug": command.Positionals[2], "buildId": command.Flags["build"], "lifetimeHours": hours}
		var result any
		if err = api("POST", "/api/projects/"+url.PathEscape(slug(command.Positionals[1]))+"/previews", payload, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if (operation == "promote" || operation == "delete") && len(command.Positionals) == 3 {
		if command.Flags["yes"] != "true" {
			return fmt.Errorf("preview %s requires --yes", operation)
		}
		path := "/api/projects/" + url.PathEscape(slug(command.Positionals[1])) + "/previews/" + url.PathEscape(command.Positionals[2])
		method := "DELETE"
		if operation == "promote" {
			method, path = "POST", path+"/promote"
		}
		return action(method, path, nil, cfg)
	}
	return errors.New("use: paasta preview create PROJECT SLUG --hours HOURS --yes | promote|delete PROJECT ID --yes")
}
func processList(name string, cfg config) ([]processView, error) {
	var result struct {
		Processes []processView `json:"processes"`
	}
	if err := api("GET", "/api/projects/"+url.PathEscape(slug(name))+"/processes", nil, &result, cfg); err != nil {
		return nil, err
	}
	return result.Processes, nil
}
func processes(name string, cfg config, jsonOutput bool) error {
	items, err := processList(name, cfg)
	if err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(map[string]any{"processes": items})
	}
	if len(items) == 0 {
		fmt.Println("No processes found.")
		return nil
	}
	for _, item := range items {
		fmt.Printf("%-18s %-8s %-12s %-14s %s\n", item.Name, item.Type, item.Status, item.Plan, item.ID)
	}
	return nil
}
func processCommandCLI(command args, cfg config) error {
	if len(command.Positionals) < 2 {
		return errors.New("use: paasta process create|update|start|stop|run|logs|delete PROJECT")
	}
	operation, project := command.Positionals[0], slug(command.Positionals[1])
	base := "/api/projects/" + url.PathEscape(project) + "/processes"
	if operation == "create" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta process create PROJECT --type worker|cron|job --name NAME --command COMMAND --plan ID --billing payg|monthly --yes")
		}
		kind, billing := command.Flags["type"], command.Flags["billing"]
		if !map[string]bool{"worker": true, "cron": true, "job": true}[kind] {
			return errors.New("--type must be worker, cron, or job")
		}
		if !map[string]bool{"payg": true, "monthly": true}[billing] {
			return errors.New("--billing must be payg or monthly")
		}
		if command.Flags["name"] == "" || command.Flags["command"] == "" || command.Flags["plan"] == "" {
			return errors.New("--name, --command, and --plan are required")
		}
		replicas := 1
		if command.Flags["replicas"] != "" {
			var err error
			replicas, err = strconv.Atoi(command.Flags["replicas"])
			if err != nil || replicas < 1 || replicas > 3 {
				return errors.New("--replicas must be between 1 and 3")
			}
		}
		if kind != "worker" && replicas != 1 {
			return errors.New("--replicas is only supported for workers")
		}
		if kind == "cron" && len(strings.Fields(command.Flags["schedule"])) != 5 {
			return errors.New("cron --schedule must have five fields")
		}
		var ctx context
		if err := api("GET", "/api/cli/context", nil, &ctx, cfg); err != nil {
			return err
		}
		var selected *plan
		for index := range ctx.Plans {
			if ctx.Plans[index].ID == command.Flags["plan"] {
				selected = &ctx.Plans[index]
				break
			}
		}
		if selected == nil {
			return errors.New("selected plan is not available")
		}
		price := selected.Hourly
		period := "hour"
		if billing == "monthly" {
			price, period = selected.Monthly, "month"
		}
		fmt.Printf("Cost: %s toman/%s", price, period)
		if replicas > 1 {
			fmt.Printf(" x %d replicas", replicas)
		}
		fmt.Println()
		if command.Flags["yes"] != "true" {
			return errors.New("review the cost and rerun with --yes")
		}
		payload := map[string]any{"type": kind, "name": command.Flags["name"], "command": command.Flags["command"], "schedule": command.Flags["schedule"], "planId": selected.ID, "billingMode": billing, "replicas": replicas}
		var result processMutationView
		if err := api("POST", base, payload, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if len(command.Positionals) != 3 {
		return errors.New("use: paasta process update|start|stop|run|logs|delete PROJECT ID")
	}
	id := command.Positionals[2]
	path := base + "/" + url.PathEscape(id)
	if operation == "logs" {
		var result processLogView
		if err := api("GET", path+"/logs", nil, &result, cfg); err != nil {
			return err
		}
		if command.Flags["json"] == "true" {
			return printJSON(result)
		}
		if result.Logs != "" {
			fmt.Print(result.Logs)
			if !strings.HasSuffix(result.Logs, "\n") {
				fmt.Println()
			}
		} else {
			fmt.Println(result.Message)
		}
		return nil
	}
	if operation == "start" || operation == "run" {
		items, err := processList(project, cfg)
		if err != nil {
			return err
		}
		var selected *processView
		for index := range items {
			if items[index].ID == id {
				selected = &items[index]
				break
			}
		}
		if selected == nil {
			return errors.New("process not found")
		}
		price, period := selected.Hourly, "hour"
		if selected.Billing == "monthly" {
			price, period = selected.Monthly, "month"
		}
		fmt.Printf("Cost: %s toman/%s", price, period)
		if selected.Replicas > 1 {
			fmt.Printf(" x %d replicas", selected.Replicas)
		}
		fmt.Println()
	}
	if command.Flags["yes"] != "true" {
		return fmt.Errorf("process %s requires --yes", operation)
	}
	var method, suffix string
	var payload any
	switch operation {
	case "start", "stop":
		method, payload = "PUT", map[string]string{"status": map[bool]string{true: "active", false: "paused"}[operation == "start"]}
	case "update":
		status := command.Flags["status"]
		if status != "active" && status != "paused" {
			return errors.New("--status must be active or paused")
		}
		payload = map[string]string{"status": status}
		if command.Flags["command"] != "" {
			payload.(map[string]string)["command"] = command.Flags["command"]
		}
		if command.Flags["schedule"] != "" {
			if len(strings.Fields(command.Flags["schedule"])) != 5 {
				return errors.New("cron --schedule must have five fields")
			}
			payload.(map[string]string)["schedule"] = command.Flags["schedule"]
		}
		method = "PUT"
	case "run":
		method, suffix = "POST", "/run"
	case "delete":
		method = "DELETE"
	default:
		return errors.New("use: paasta process update|start|stop|run|logs|delete PROJECT ID")
	}
	var result processMutationView
	if err := api(method, path+suffix, payload, &result, cfg); err != nil {
		return err
	}
	return printJSON(result)
}
func flagBool(flags map[string]string, name string, fallback bool) (bool, error) {
	raw, exists := flags[name]
	if !exists {
		return fallback, nil
	}
	if raw == "true" {
		return true, nil
	}
	if raw == "false" {
		return false, nil
	}
	return false, fmt.Errorf("--%s must be true or false", name)
}
func availabilityCommand(command args, cfg config) error {
	project := ""
	setting := len(command.Positionals) == 2 && command.Positionals[0] == "set"
	if len(command.Positionals) == 1 {
		project = slug(command.Positionals[0])
	} else if setting {
		project = slug(command.Positionals[1])
	} else {
		return errors.New("use: paasta availability PROJECT | availability set PROJECT [options] --yes")
	}
	path := "/api/projects/" + url.PathEscape(project) + "/availability"
	var current availabilityView
	if err := api("GET", path, nil, &current, cfg); err != nil {
		return err
	}
	if !setting {
		if command.Flags["json"] == "true" {
			return printJSON(current)
		}
		mode := "manual"
		if current.Autoscaling {
			mode = "autoscaling"
		}
		fmt.Printf("%s: %s, replicas %d-%d, CPU %d%%, HA %t\n", project, mode, current.MinReplicas, current.MaxReplicas, current.CPUTarget, current.HighAvailability)
		return nil
	}
	autoscaling, err := flagBool(command.Flags, "autoscaling", current.Autoscaling)
	if err != nil {
		return err
	}
	highAvailability, err := flagBool(command.Flags, "ha", current.HighAvailability)
	if err != nil {
		return err
	}
	minReplicas, maxReplicas, cpuTarget := current.MinReplicas, current.MaxReplicas, current.CPUTarget
	for flag, target := range map[string]*int{"min": &minReplicas, "max": &maxReplicas, "cpu": &cpuTarget} {
		if command.Flags[flag] != "" {
			parsed, parseErr := strconv.Atoi(command.Flags[flag])
			if parseErr != nil {
				return fmt.Errorf("--%s must be a number", flag)
			}
			*target = parsed
		}
	}
	if minReplicas < 1 || maxReplicas < minReplicas || maxReplicas > 3 {
		return errors.New("--min and --max must define a range between 1 and 3")
	}
	if cpuTarget < 20 || cpuTarget > 90 {
		return errors.New("--cpu must be between 20 and 90")
	}
	if highAvailability && autoscaling && minReplicas < 2 {
		return errors.New("HA with autoscaling requires --min 2 or greater")
	}
	if highAvailability && !autoscaling && current.DesiredReplicas < 2 {
		return errors.New("HA without autoscaling requires scaling the project to at least 2 replicas first")
	}
	if (current.HasRwoVolume || current.Stack == "n8n") && (highAvailability || autoscaling && maxReplicas > 1) {
		return errors.New("this project uses single-replica storage and cannot enable multiple replicas")
	}
	billedMin, billedMax := current.DesiredReplicas, current.DesiredReplicas
	if autoscaling {
		billedMin, billedMax = minReplicas, maxReplicas
	}
	hourly, _ := strconv.ParseInt(current.HourlyPriceToman, 10, 64)
	monthly, _ := strconv.ParseInt(current.MonthlyPriceToman, 10, 64)
	if current.BillingMode == "monthly" {
		fmt.Printf("Maximum monthly capacity: %d toman (%d replicas)\n", monthly*int64(billedMax), billedMax)
	} else {
		fmt.Printf("Hourly range: %d-%d toman (%d-%d replicas)\n", hourly*int64(billedMin), hourly*int64(billedMax), billedMin, billedMax)
	}
	if command.Flags["yes"] != "true" {
		return errors.New("review the capacity cost and rerun with --yes")
	}
	payload := map[string]any{"autoscaling": autoscaling, "highAvailability": highAvailability, "minReplicas": minReplicas, "maxReplicas": maxReplicas, "cpuTarget": cpuTarget}
	var result availabilityMutationView
	if err = api("PUT", path, payload, &result, cfg); err != nil {
		return err
	}
	return printJSON(result)
}
func resourceAlertsCommand(command args, cfg config) error {
	if len(command.Positionals) < 1 {
		return errors.New("use: paasta alerts PROJECT | alert set|delete PROJECT [options] --yes")
	}
	if command.Command == "alerts" {
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta alerts PROJECT [--json]")
		}
		project := slug(command.Positionals[0])
		path := "/api/projects/" + url.PathEscape(project) + "/resource-alerts"
		var result struct {
			Rules []resourceAlertRuleView `json:"rules"`
		}
		if err := api("GET", path, nil, &result, cfg); err != nil {
			return err
		}
		if command.Flags["json"] == "true" {
			return printJSON(result)
		}
		if len(result.Rules) == 0 {
			fmt.Println("No resource alert rules found.")
			return nil
		}
		for _, rule := range result.Rules {
			fmt.Printf("%-36s %-16s %-6s %3d%% for %2dm  %s\n", rule.ID, rule.ServiceName, rule.Metric, rule.ThresholdPercent, rule.DurationMinutes, rule.Severity)
		}
		return nil
	}
	if len(command.Positionals) != 2 {
		return errors.New("use: paasta alert set|delete PROJECT [options] --yes")
	}
	operation := command.Positionals[0]
	project := slug(command.Positionals[1])
	path := "/api/projects/" + url.PathEscape(project) + "/resource-alerts"
	if operation == "set" {
		metric := command.Flags["metric"]
		severity := value(command.Flags, "severity", "warning")
		service := value(command.Flags, "service", "app")
		threshold, thresholdErr := strconv.Atoi(command.Flags["threshold"])
		duration, durationErr := strconv.Atoi(command.Flags["duration"])
		if service == "" || len(service) > 63 || !map[string]bool{"cpu": true, "memory": true}[metric] || thresholdErr != nil || threshold < 1 || threshold > 100 || durationErr != nil || !map[int]bool{5: true, 10: true, 15: true, 30: true, 60: true}[duration] || !map[string]bool{"warning": true, "critical": true}[severity] {
			return errors.New("use: paasta alert set PROJECT --service NAME --metric cpu|memory --threshold 1..100 --duration 5|10|15|30|60 --severity warning|critical --yes")
		}
		if command.Flags["yes"] != "true" {
			return errors.New("setting a resource alert requires --yes")
		}
		var created resourceAlertRuleView
		payload := map[string]any{"serviceName": service, "metric": metric, "thresholdPercent": threshold, "durationMinutes": duration, "severity": severity}
		if err := api("POST", path, payload, &created, cfg); err != nil {
			return err
		}
		return printJSON(created)
	}
	if operation == "delete" {
		id := command.Flags["id"]
		if id == "" {
			return errors.New("resource alert deletion requires --id")
		}
		if command.Flags["yes"] != "true" {
			return errors.New("resource alert deletion requires --yes")
		}
		var deleted map[string]any
		if err := api("DELETE", path, map[string]string{"id": id}, &deleted, cfg); err != nil {
			return err
		}
		return printJSON(deleted)
	}
	return errors.New("use: paasta alert set|delete PROJECT [options] --yes")
}
func gitOperationsCommand(command args, cfg config) error {
	if len(command.Positionals) < 1 {
		return errors.New("use: paasta git PROJECT | git connections|repositories|branches|auto-deploy")
	}
	operation := command.Positionals[0]
	jsonOutput := command.Flags["json"] == "true"
	if operation == "connections" {
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta git connections [--json]")
		}
		var result struct {
			Connections []gitConnectionView `json:"connections"`
		}
		if err := api("GET", "/api/integrations/git/connections", nil, &result, cfg); err != nil {
			return err
		}
		if jsonOutput {
			return printJSON(result)
		}
		if len(result.Connections) == 0 {
			fmt.Println("No Git connections found. Connect GitHub or GitLab in the Paasta console first.")
			return nil
		}
		for _, item := range result.Connections {
			fmt.Printf("%-8s %-24s %s\n", item.Provider, item.Username, item.ID)
		}
		return nil
	}
	if operation == "repositories" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta git repositories CONNECTION_ID [--json]")
		}
		var result struct {
			Repositories []struct {
				Name, URL, DefaultBranch string
				Private                  bool
			} `json:"repositories"`
		}
		path := "/api/integrations/git/repositories?connectionId=" + url.QueryEscape(command.Positionals[1])
		if err := api("GET", path, nil, &result, cfg); err != nil {
			return err
		}
		if jsonOutput {
			return printJSON(result)
		}
		for _, item := range result.Repositories {
			visibility := "public"
			if item.Private {
				visibility = "private"
			}
			fmt.Printf("%-9s %-20s %s\n", visibility, item.DefaultBranch, item.URL)
		}
		return nil
	}
	if operation == "branches" {
		if len(command.Positionals) != 3 {
			return errors.New("use: paasta git branches CONNECTION_ID REPOSITORY [--json]")
		}
		path := "/api/integrations/git/repositories?connectionId=" + url.QueryEscape(command.Positionals[1]) + "&repository=" + url.QueryEscape(command.Positionals[2])
		var result struct {
			Branches []string `json:"branches"`
		}
		if err := api("GET", path, nil, &result, cfg); err != nil {
			return err
		}
		if jsonOutput {
			return printJSON(result)
		}
		for _, branch := range result.Branches {
			fmt.Println(branch)
		}
		return nil
	}
	if operation == "auto-deploy" {
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta git auto-deploy PROJECT --enabled true|false --yes")
		}
		enabled, err := strconv.ParseBool(command.Flags["enabled"])
		if err != nil {
			return errors.New("--enabled must be true or false")
		}
		var result map[string]any
		path := "/api/projects/" + url.PathEscape(slug(command.Positionals[1])) + "/git"
		if err = api("POST", path, map[string]any{"action": "toggle", "enabled": enabled}, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if len(command.Positionals) != 1 {
		return errors.New("use: paasta git PROJECT [--json]")
	}
	var result gitProjectView
	path := "/api/projects/" + url.PathEscape(slug(operation)) + "/git"
	if err := api("GET", path, nil, &result, cfg); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	fmt.Printf("Repository: %s\nRef: %s\nRoot: %s\nAuto deploy: %t\nWebhook: %t (managed: %t)\nConnected account: %t\n", result.Repository, result.Ref, result.Root, result.AutoDeploy, result.WebhookConfigured, result.ManagedWebhook, result.ConnectedAccount)
	return nil
}
func validUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for index, character := range id {
		hyphen := index == 8 || index == 13 || index == 18 || index == 23
		if (hyphen && character != '-') || (!hyphen && !strings.ContainsRune("0123456789abcdefABCDEF", character)) {
			return false
		}
	}
	return true
}
func teamProjectIDs(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return []string{}, nil
	}
	result := []string{}
	for _, id := range strings.Split(value, ",") {
		id = strings.TrimSpace(id)
		if !validUUID(id) {
			return nil, errors.New("--projects must be a comma-separated list of project UUIDs")
		}
		result = append(result, id)
	}
	return result, nil
}
func teamCommand(command args, cfg config) error {
	jsonOutput := command.Flags["json"] == "true"
	if len(command.Positionals) == 0 || (len(command.Positionals) == 1 && command.Positionals[0] == "list") {
		var result teamInventory
		if err := api("GET", "/api/team", nil, &result, cfg); err != nil {
			return err
		}
		if jsonOutput {
			return printJSON(result)
		}
		fmt.Println("Members")
		for _, member := range result.Members {
			fmt.Printf("%-10s %-28s %-36s %d projects\n", member.Role, member.Email, member.ID, len(member.ProjectIDs))
		}
		if len(result.Invitations) > 0 {
			fmt.Println("\nPending invitations")
			for _, invitation := range result.Invitations {
				fmt.Printf("%-10s %-28s %-36s expires %s\n", invitation.Role, invitation.Email, invitation.ID, invitation.ExpiresAt)
			}
		}
		if len(result.Projects) > 0 {
			fmt.Println("\nProjects")
			for _, project := range result.Projects {
				fmt.Printf("%-28s %s\n", project.Name, project.ID)
			}
		}
		return nil
	}
	if command.Flags["yes"] != "true" {
		return errors.New("team mutations require --yes")
	}
	operation := command.Positionals[0]
	if operation == "invite" {
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta team invite EMAIL --role admin|developer|viewer [--projects ID,ID] --yes")
		}
		role := command.Flags["role"]
		if !map[string]bool{"admin": true, "developer": true, "viewer": true}[role] {
			return errors.New("--role must be admin, developer, or viewer")
		}
		if _, err := url.ParseRequestURI("mailto:" + command.Positionals[1]); err != nil || !strings.Contains(command.Positionals[1], "@") {
			return errors.New("a valid email is required")
		}
		projects, err := teamProjectIDs(command.Flags["projects"])
		if err != nil {
			return err
		}
		var result map[string]any
		if err = api("POST", "/api/team", map[string]any{"email": command.Positionals[1], "role": role, "projectIds": projects}, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if operation == "member" && len(command.Positionals) == 3 {
		actionName, userID := command.Positionals[1], command.Positionals[2]
		if actionName == "remove" {
			var result map[string]any
			if err := api("DELETE", "/api/team", map[string]string{"userId": userID}, &result, cfg); err != nil {
				return err
			}
			return printJSON(result)
		}
		if actionName == "update" {
			role := command.Flags["role"]
			if !map[string]bool{"admin": true, "developer": true, "viewer": true}[role] {
				return errors.New("--role must be admin, developer, or viewer")
			}
			projects, err := teamProjectIDs(command.Flags["projects"])
			if err != nil {
				return err
			}
			var result map[string]any
			if err = api("PATCH", "/api/team", map[string]any{"userId": userID, "role": role, "projectIds": projects}, &result, cfg); err != nil {
				return err
			}
			return printJSON(result)
		}
	}
	if operation == "invitation" && len(command.Positionals) == 3 && command.Positionals[1] == "cancel" {
		var result map[string]any
		if err := api("DELETE", "/api/team", map[string]string{"invitationId": command.Positionals[2]}, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	return errors.New("use: paasta team [list] | team invite EMAIL | team member update|remove USER_ID | team invitation cancel ID")
}
func operationKey(value string) (string, error) {
	if value != "" {
		if !validUUID(value) {
			return "", errors.New("--operation-key must be a UUID")
		}
		return strings.ToLower(value), nil
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}
func domainNameservers(value string) ([]string, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	result := []string{}
	seen := map[string]bool{}
	for _, entry := range strings.Split(value, ",") {
		entry = strings.ToLower(strings.TrimSpace(entry))
		if entry != "" && !seen[entry] {
			seen[entry] = true
			result = append(result, entry)
		}
	}
	if len(result) < 2 || len(result) > 5 {
		return nil, errors.New("--nameservers requires 2 to 5 comma-separated hostnames")
	}
	for _, entry := range result {
		if !strings.Contains(entry, ".") || strings.ContainsAny(entry, " /:@") {
			return nil, errors.New("--nameservers contains an invalid hostname")
		}
	}
	return result, nil
}
func domainSecret(path string) (string, error) {
	if path == "" {
		return "", errors.New("--auth-code-file is required for transfer")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 4096 {
		return "", errors.New("--auth-code-file must be a regular file up to 4 KiB")
	}
	data, err := os.ReadFile(path)
	code := strings.TrimSpace(string(data))
	if err != nil || len(code) < 4 || len(code) > 200 {
		return "", errors.New("transfer code must contain 4 to 200 characters")
	}
	return code, nil
}
func domainQuote(operation, target string, years int, privacy bool, cfg config) (domainQuoteView, error) {
	query := url.Values{"operation": {operation}, "years": {strconv.Itoa(years)}}
	if operation == "renew" || operation == "restore" {
		query.Set("domainId", target)
	} else {
		query.Set("domain", target)
		if privacy {
			query.Set("privacy", "1")
		}
	}
	var quote domainQuoteView
	err := api("GET", "/api/domain-registration/search?"+query.Encode(), nil, &quote, cfg)
	return quote, err
}
func domainOrder(command args, cfg config) error {
	operation := command.Positionals[0]
	if len(command.Positionals) != 2 {
		return errors.New("use: paasta domain register|transfer DOMAIN | renew|restore DOMAIN_ID [options] --yes")
	}
	years := 1
	if operation == "register" || operation == "renew" {
		parsed, err := strconv.Atoi(value(command.Flags, "years", "1"))
		if err != nil || parsed < 1 || parsed > 10 {
			return errors.New("--years must be between 1 and 10")
		}
		years = parsed
	}
	privacy, err := flagBool(command.Flags, "privacy", false)
	if err != nil {
		return err
	}
	quote, err := domainQuote(operation, command.Positionals[1], years, privacy, cfg)
	if err != nil {
		return err
	}
	fmt.Printf("Charge: %d toman for %s (%d year)\n", quote.PriceToman, quote.Domain, quote.Years)
	if command.Flags["yes"] != "true" {
		return errors.New("domain orders require --yes after reviewing the charge")
	}
	if operation == "register" && quote.Available != nil && !*quote.Available {
		return errors.New("domain is not available")
	}
	key, err := operationKey(command.Flags["operation-key"])
	if err != nil {
		return err
	}
	payload := map[string]any{"operation": operation, "years": years, "privacy": privacy, "idempotencyKey": key}
	if operation == "renew" || operation == "restore" {
		payload["domainId"] = command.Positionals[1]
	} else {
		payload["domain"] = quote.Domain
		payload["irnicHandle"] = command.Flags["irnic-handle"]
		nameservers, parseErr := domainNameservers(command.Flags["nameservers"])
		if parseErr != nil {
			return parseErr
		}
		if nameservers != nil {
			payload["nameservers"] = nameservers
		}
	}
	if operation == "transfer" {
		payload["authCode"], err = domainSecret(command.Flags["auth-code-file"])
		if err != nil {
			return err
		}
	}
	var result domainOrderView
	if err = api("POST", "/api/domain-registration/orders", payload, &result, cfg); err != nil {
		return fmt.Errorf("%w (retry safely with --operation-key %s)", err, key)
	}
	if command.Flags["json"] == "true" {
		return printJSON(map[string]any{"order": result, "operationKey": key, "priceToman": quote.PriceToman})
	}
	fmt.Printf("Order: %s\nDomain: %s\nStatus: %s\nOperation key: %s\n", result.OrderID, result.DomainID, result.Status, key)
	return nil
}
func managedDomainCommand(command args, cfg config) error {
	jsonOutput := command.Flags["json"] == "true"
	if len(command.Positionals) == 0 || command.Positionals[0] == "list" {
		var inventory registeredDomainInventory
		if err := api("GET", "/api/domain-registration/domains", nil, &inventory, cfg); err != nil {
			return err
		}
		if jsonOutput {
			return printJSON(inventory)
		}
		for _, domain := range inventory.Domains {
			expires := "pending"
			if domain.ExpiresAt != nil {
				expires = *domain.ExpiresAt
			}
			fmt.Printf("%-28s %-22s expires %-24s %s\n", domain.FQDN, domain.Status, expires, domain.ID)
		}
		return nil
	}
	operation := command.Positionals[0]
	if operation == "register" || operation == "transfer" || operation == "renew" || operation == "restore" {
		return domainOrder(command, cfg)
	}
	if operation == "quote" && len(command.Positionals) == 2 {
		years, err := strconv.Atoi(value(command.Flags, "years", "1"))
		if err != nil || years < 1 || years > 10 {
			return errors.New("--years must be between 1 and 10")
		}
		privacy, err := flagBool(command.Flags, "privacy", false)
		if err != nil {
			return err
		}
		kind := value(command.Flags, "operation", "register")
		if kind != "register" && kind != "transfer" {
			return errors.New("--operation must be register or transfer")
		}
		quote, err := domainQuote(kind, command.Positionals[1], years, privacy, cfg)
		if err != nil {
			return err
		}
		return printJSON(quote)
	}
	if operation == "info" && len(command.Positionals) == 2 {
		var result any
		if err := api("GET", "/api/domain-registration/domains/"+url.PathEscape(command.Positionals[1]), nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	}
	if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
		return errors.New("domain setting changes require DOMAIN_ID and --yes")
	}
	path := "/api/domain-registration/domains/" + url.PathEscape(command.Positionals[1])
	payload := map[string]any{"action": operation}
	switch operation {
	case "nameservers":
		nameservers, err := domainNameservers(command.Flags["set"])
		if err != nil {
			return err
		}
		payload["nameservers"] = nameservers
	case "auto-renew":
		enabled, err := flagBool(command.Flags, "enabled", false)
		if err != nil {
			return err
		}
		payload["enabled"] = enabled
	case "transfer-lock":
		locked, err := flagBool(command.Flags, "locked", true)
		if err != nil {
			return err
		}
		payload["locked"] = locked
	case "transfer-code":
		if command.Flags["show-secret"] != "true" {
			return errors.New("transfer-code requires --show-secret and --yes")
		}
	case "retry-order":
		if command.Flags["order"] == "" {
			return errors.New("retry-order requires --order ORDER_ID")
		}
		payload["orderId"] = command.Flags["order"]
	default:
		return errors.New("use: paasta domain quote|register|transfer|renew|restore|info|nameservers|auto-renew|transfer-lock|transfer-code|retry-order")
	}
	var result any
	if err := api("PATCH", path, payload, &result, cfg); err != nil {
		return err
	}
	if jsonOutput || operation == "transfer-code" {
		return printJSON(result)
	}
	fmt.Println("Domain setting updated.")
	return nil
}
func monitorCommand(command args, cfg config) error {
	project := ""
	setting := len(command.Positionals) == 2 && command.Positionals[0] == "set"
	if len(command.Positionals) == 1 {
		project = slug(command.Positionals[0])
	} else if setting {
		project = slug(command.Positionals[1])
	} else {
		return errors.New("use: paasta monitor PROJECT | monitor set PROJECT [options] --yes")
	}
	path := "/api/projects/" + url.PathEscape(project) + "/monitor"
	var current monitorView
	if err := api("GET", path, nil, &current, cfg); err != nil {
		return err
	}
	if !setting {
		if command.Flags["json"] == "true" {
			return printJSON(current)
		}
		state := "disabled"
		if current.Enabled {
			state = "enabled"
		}
		last := "never checked"
		if current.LastStatus != nil && current.LastLatency != nil {
			last = fmt.Sprintf("HTTP %d in %dms", *current.LastStatus, *current.LastLatency)
		} else if current.LastError != "" {
			last = current.LastError
		}
		availability := "no 24h samples"
		if current.Availability24h != nil {
			availability = fmt.Sprintf("%.2f%% availability (24h)", *current.Availability24h)
		}
		fmt.Printf("%s: %s, path %s, fail after %d checks\nLast: %s; %s\n", project, state, current.Path, current.FailureThreshold, last, availability)
		return nil
	}
	enabled, err := flagBool(command.Flags, "enabled", current.Enabled)
	if err != nil {
		return err
	}
	monitorPath := value(command.Flags, "path", current.Path)
	if len(monitorPath) == 0 || len(monitorPath) > 200 || !strings.HasPrefix(monitorPath, "/") || strings.HasPrefix(monitorPath, "//") {
		return errors.New("--path must be a local path starting with / and at most 200 characters")
	}
	failures := current.FailureThreshold
	if command.Flags["failures"] != "" {
		failures, err = strconv.Atoi(command.Flags["failures"])
		if err != nil {
			return errors.New("--failures must be 1, 2, 3, or 5")
		}
	}
	if !map[int]bool{1: true, 2: true, 3: true, 5: true}[failures] {
		return errors.New("--failures must be 1, 2, 3, or 5")
	}
	if command.Flags["yes"] != "true" {
		return errors.New("changing the uptime monitor requires --yes")
	}
	var result monitorView
	if err = api("PATCH", path, map[string]any{"enabled": enabled, "path": monitorPath, "failureThreshold": failures}, &result, cfg); err != nil {
		return err
	}
	return printJSON(result)
}
func logs(name string, command args, cfg config) error {
	name = slug(name)
	if name == "" {
		return errors.New("project name is required")
	}
	last := ""
	for {
		path := fmt.Sprintf("/api/projects/%s/logs?tail=%s&since=%s", url.PathEscape(name), value(command.Flags, "tail", "300"), value(command.Flags, "since", "3600"))
		response, data, err := requestRaw("GET", endpoint(cfg.Server, path), nil, "", cfg.Token)
		if err != nil {
			return err
		}
		if response.StatusCode != 200 {
			return fmt.Errorf("logs: %s", strings.TrimSpace(string(data)))
		}
		current := string(data)
		if current != last {
			delta := current
			if strings.HasPrefix(current, last) {
				delta = strings.TrimPrefix(current, last)
			}
			fmt.Print(delta)
			if !strings.HasSuffix(delta, "\n") {
				fmt.Println()
			}
			last = current
		}
		if command.Flags["follow"] != "true" {
			return nil
		}
		time.Sleep(3 * time.Second)
	}
}
func execCommand(command args, cfg config) error {
	if len(command.Positionals) < 2 {
		return errors.New("use: paasta exec PROJECT [--pod POD] [--container CONTAINER] -- COMMAND [ARG...]")
	}
	name := slug(command.Positionals[0])
	if name == "" {
		return errors.New("project name is required")
	}
	payload := map[string]any{"command": command.Positionals[1:]}
	if pod := command.Flags["pod"]; pod != "" {
		payload["pod"] = pod
	}
	if container := command.Flags["container"]; container != "" {
		payload["container"] = container
	}
	var result struct {
		Stdout    string `json:"stdout"`
		Stderr    string `json:"stderr"`
		ExitCode  int    `json:"exitCode"`
		Pod       string `json:"pod"`
		Container string `json:"container"`
	}
	if err := api("POST", "/api/projects/"+url.PathEscape(name)+"/exec", payload, &result, cfg); err != nil {
		return err
	}
	if result.Stdout != "" {
		fmt.Print(result.Stdout)
	}
	if result.Stderr != "" {
		fmt.Fprint(os.Stderr, result.Stderr)
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("command exited with status %d", result.ExitCode)
	}
	return nil
}
func environment(name string, command args, cfg config) error {
	name = slug(name)
	if name == "" {
		return errors.New("project name is required")
	}
	var env map[string]string
	if err := api("GET", "/api/projects/"+url.PathEscape(name)+"/environment", nil, &env, cfg); err != nil {
		return err
	}
	operation := "list"
	if len(command.Positionals) > 1 {
		operation = command.Positionals[1]
	}
	switch operation {
	case "list":
		keys := make([]string, 0, len(env))
		for key := range env {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			shown := "••••••••"
			if command.Flags["show"] == "true" {
				shown = env[key]
			}
			fmt.Printf("%s=%s\n", key, shown)
		}
		return nil
	case "set":
		for _, pair := range command.Positionals[2:] {
			parts := strings.SplitN(pair, "=", 2)
			if len(parts) != 2 {
				return fmt.Errorf("invalid variable: %s", pair)
			}
			env[parts[0]] = parts[1]
		}
	case "unset":
		for _, key := range command.Positionals[2:] {
			delete(env, key)
		}
	default:
		return errors.New("use: paasta env NAME list|set|unset")
	}
	return action("PUT", "/api/projects/"+url.PathEscape(name)+"/environment", env, cfg)
}

func apiCommand(command args, cfg config) error {
	if len(command.Positionals) < 2 {
		return errors.New("use: paasta api METHOD /api/PATH [--data JSON]")
	}
	method := strings.ToUpper(command.Positionals[0])
	if !map[string]bool{"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}[method] {
		return errors.New("API method must be GET, POST, PUT, PATCH, or DELETE")
	}
	path := command.Positionals[1]
	if !strings.HasPrefix(path, "/api/") || strings.Contains(path, "://") {
		return errors.New("API path must start with /api/")
	}
	var input any
	if data := command.Flags["data"]; data != "" {
		if err := json.Unmarshal([]byte(data), &input); err != nil {
			return errors.New("--data must be valid JSON")
		}
	}
	var output any
	if err := api(method, path, input, &output, cfg); err != nil {
		return err
	}
	return printJSON(output)
}

func help() {
	fmt.Printf(`Paasta CLI %s - deploy without infrastructure noise

Usage:
  paasta login [--server URL]                 Browser login with a complete authorize link
  paasta login --api-key TOKEN                API key login for CI/CD and automation
  paasta whoami | projects | status NAME
  paasta deploy [PATH] [-n NAME] [-p PLAN] [--billing payg|monthly] [-r REGION]
  paasta deploy [PATH] --dry-run [--json]     Preview local files without login or upload
  paasta deploy --image IMAGE --name NAME     Deploy a public Docker image
  paasta deploy --git URL --connection ID --name NAME
                                                Deploy a public or private Git repository
  paasta git PROJECT [--json]
  paasta git connections [--json]
  paasta git repositories CONNECTION_ID [--json]
  paasta git branches CONNECTION_ID REPOSITORY [--json]
  paasta git auto-deploy PROJECT --enabled true|false --yes
  paasta team [list] [--json]
  paasta team invite EMAIL --role admin|developer|viewer [--projects ID,ID] --yes
  paasta team member update USER_ID --role ROLE [--projects ID,ID] --yes
  paasta team member remove USER_ID --yes | team invitation cancel ID --yes
  paasta domains [--json] | domains PROJECT [--json]
  paasta domain quote DOMAIN [--operation register|transfer] [--years N] [--privacy true]
  paasta domain register DOMAIN [--years N] [--privacy true] [--nameservers NS,NS] [--irnic-handle HANDLE] [--operation-key UUID] --yes
  paasta domain transfer DOMAIN --auth-code-file FILE [--nameservers NS,NS] [--irnic-handle HANDLE] [--operation-key UUID] --yes
  paasta domain renew|restore DOMAIN_ID [--years N] [--operation-key UUID] --yes
  paasta domain info DOMAIN_ID | nameservers DOMAIN_ID --set NS,NS --yes
  paasta domain auto-renew DOMAIN_ID --enabled true|false --yes
  paasta domain transfer-lock DOMAIN_ID --locked true|false --yes
  paasta domain transfer-code DOMAIN_ID --show-secret --yes | retry-order DOMAIN_ID --order ORDER_ID --yes
  paasta deployments PROJECT [--json]
  paasta deployment status|logs BUILD_ID
  paasta deployment retry BUILD_ID --yes
  paasta deployment rollback PROJECT --build BUILD_ID --yes
  paasta previews PROJECT [--json]
  paasta preview create PROJECT SLUG --hours 24 [--build BUILD_ID] --yes
  paasta preview promote|delete PROJECT ID --yes
  paasta processes PROJECT [--json]
  paasta process create PROJECT --type worker|cron|job --name NAME --command COMMAND --plan ID --billing payg|monthly --yes
  paasta process update PROJECT ID --status active|paused [--command COMMAND] [--schedule CRON] --yes
  paasta process start|stop|run|delete PROJECT ID --yes
  paasta process logs PROJECT ID [--json]
  paasta availability PROJECT [--json]
  paasta availability set PROJECT --autoscaling true|false --min 1 --max 3 --cpu 70 --ha true|false --yes
  paasta alerts PROJECT [--json]
  paasta alert set PROJECT --service app --metric cpu|memory --threshold 80 --duration 10 --severity warning|critical --yes
  paasta alert delete PROJECT --id ID --yes
  paasta monitor PROJECT [--json]
  paasta monitor set PROJECT --enabled true|false --path /health --failures 3 --yes
  paasta logs NAME [-f] [--tail 300] [--since 3600]
  paasta exec PROJECT [--pod POD] [--container CONTAINER] -- COMMAND [ARG...]
  paasta env NAME list [--show]
  paasta env NAME set KEY=VALUE [...] | unset KEY [...]
  paasta plan list | plan set NAME PLAN
  paasta scale NAME REPLICAS | start NAME | stop NAME | restart NAME
  paasta volumes | volume create PROJECT --name NAME --offering ID --size GB --mount PATH
  paasta volume resize ID SIZE | volume backup ID | volume snapshot ID
  paasta volume files ID [--path /] [--json]
  paasta volume file download ID REMOTE_PATH --output FILE [--overwrite]
  paasta volume file upload ID LOCAL_FILE --path REMOTE_PATH [--overwrite] --yes
  paasta volume file copy ID SOURCE DESTINATION --yes
  paasta volume file zip ID SOURCE DESTINATION.zip --yes
  paasta volume file extract ID ARCHIVE.zip DESTINATION --yes
  paasta volume file mkdir ID PATH --yes
  paasta volume file rename ID SOURCE DESTINATION --yes | delete ID PATH --yes
  paasta backups [--json]
  paasta backup download ID --output FILE [--overwrite]
  paasta backup restore|delete ID --yes | snapshot restore|delete ID --yes
  paasta databases | database create PROJECT --name NAME --plan ID --storage ID --size GB
  paasta database access ID [--json]
  paasta database credential create ID --database NAME --username NAME --yes [--show-secret]
  paasta database credential reveal ID CREDENTIAL_ID --show-secret
  paasta database credential rotate|delete ID CREDENTIAL_ID --yes [--show-secret]
  paasta database connection create ID CREDENTIAL_ID --project PROJECT_ID --yes
  paasta database connection delete ID CONNECTION_ID --yes
  paasta database backups ID [--json] | database backup ID
  paasta database backup download DATABASE_ID BACKUP_ID --output FILE
  paasta database backup verify DATABASE_ID BACKUP_ID
  paasta database backup restore|delete DATABASE_ID BACKUP_ID --yes
  paasta database policy ID --schedule daily --retention 7
  paasta database pitr enable|disable ID --yes | database recover ID --at RFC3339 --yes
  paasta notifications [--json]
  paasta notification preference set KIND --email true --sms false --yes
  paasta notification channel create --name NAME --kind email|sms --destination VALUE --yes
  paasta notification channel create --name NAME --kind webhook --url URL --secret-file FILE --yes
  paasta notification channel enable|disable|test|delete ID --yes
  paasta support tickets | support ticket ID [--json]
  paasta support create --subject TEXT --body-file FILE [--attachment FILE] --yes
  paasta support reply ID --body-file FILE [--attachment FILE] --yes
  paasta support close ID --yes
  paasta support attachment TICKET_ID MESSAGE_ID --output FILE [--overwrite]
  paasta cdn sites|plans [--json] | cdn site ID [--json]
  paasta cdn create DOMAIN --origin HOST --scheme https --plan ID [--records-file FILE] --yes
  paasta cdn cancel|renew|delete ID --yes | cdn plan ID --plan PLAN_ID --yes
  paasta cdn records ID | cdn record add|update|delete ID [flags] --yes
  paasta cdn origin ID | cdn origin set ID --file JSON --yes
  paasta cdn purge ID --paths /,/assets/* --yes | cdn feature ID --name tls --enabled true --yes
  paasta cdn firewall ID | cdn firewall add|update|toggle|move|delete ID [flags] --yes
  paasta domains PROJECT | domain add PROJECT HOST | verify PROJECT ID
  paasta topup AMOUNT                            Open secure payment in browser
  paasta api METHOD /api/PATH [--data JSON]      Access any scoped public API operation
  paasta setup agent [--agent claude-code|codex|cursor|print]
  paasta mcp                                    Start the local MCP bridge for AI agents
  paasta update | delete NAME --yes | logout | version

Local source: root .paastaignore replaces .gitignore rules. Otherwise nested .gitignore files apply.
Ignored environment files are not imported. Built-in secret/dependency exclusions always apply.
Automation: add --yes and --json where supported. Secrets are never included in source archives.
`, version)
}

func run(command args) error {
	if value, exists := command.Flags["dry-run"]; command.Command == "deploy" && exists && value != "true" && value != "false" {
		return errors.New("--dry-run must be true or false")
	}
	if command.Command == "deploy" && command.Flags["dry-run"] == "true" && command.Flags["help"] != "true" {
		return previewSource(command)
	}
	if command.Command == "help" || command.Flags["help"] == "true" {
		help()
		return nil
	}
	if command.Command == "version" {
		fmt.Println("paasta", version, runtime.GOOS+"/"+runtime.GOARCH)
		return nil
	}
	if command.Command == "update" {
		return updateCLI(value(command.Flags, "server", defaultServer))
	}
	if command.Command == "login" {
		return login(value(command.Flags, "server", defaultServer), command.Flags["api-key"])
	}
	if command.Command == "logout" {
		path, _ := configPath()
		_ = os.Remove(path)
		success("Logged out")
		return nil
	}
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	switch command.Command {
	case "setup":
		if len(command.Positionals) != 1 || command.Positionals[0] != "agent" {
			return errors.New("use: paasta setup agent [--agent claude-code|codex|cursor|print] [--no-skill]")
		}
		return setupAgent(command)
	case "mcp":
		return runMCP(cfg)
	case "whoami", "context":
		var ctx context
		if err = api("GET", "/api/cli/context", nil, &ctx, cfg); err == nil {
			if command.Flags["json"] == "true" {
				return printJSON(ctx)
			}
			fmt.Printf("%s <%s>\nBalance: %d toman\n", ctx.Account.Name, ctx.Account.Email, ctx.Account.Balance)
		}
		return err
	case "projects", "list":
		return projects(cfg, command.Flags["json"] == "true")
	case "status":
		if len(command.Positionals) < 1 {
			return errors.New("project name is required")
		}
		return projectStatus(command.Positionals[0], cfg)
	case "deploy":
		return deploy(command, cfg)
	case "deployments":
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta deployments PROJECT [--json]")
		}
		return deployments(command.Positionals[0], cfg, command.Flags["json"] == "true")
	case "deployment":
		return deploymentCommand(command, cfg)
	case "previews":
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta previews PROJECT [--json]")
		}
		return previews(command.Positionals[0], cfg, command.Flags["json"] == "true")
	case "preview":
		return previewCommand(command, cfg)
	case "processes":
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta processes PROJECT [--json]")
		}
		return processes(command.Positionals[0], cfg, command.Flags["json"] == "true")
	case "process":
		return processCommandCLI(command, cfg)
	case "availability":
		return availabilityCommand(command, cfg)
	case "alerts", "alert":
		return resourceAlertsCommand(command, cfg)
	case "monitor":
		return monitorCommand(command, cfg)
	case "git":
		return gitOperationsCommand(command, cfg)
	case "team":
		return teamCommand(command, cfg)
	case "logs":
		if len(command.Positionals) < 1 {
			return errors.New("project name is required")
		}
		return logs(command.Positionals[0], command, cfg)
	case "exec":
		return execCommand(command, cfg)
	case "env":
		if len(command.Positionals) < 1 {
			return errors.New("project name is required")
		}
		return environment(command.Positionals[0], command, cfg)
	case "api":
		return apiCommand(command, cfg)
	case "plan":
		if len(command.Positionals) == 0 || command.Positionals[0] == "list" {
			var ctx context
			if err = api("GET", "/api/cli/context", nil, &ctx, cfg); err == nil {
				for _, p := range ctx.Plans {
					fmt.Printf("%-12s %4dm CPU  %4dMiB RAM  %s toman/month\n", p.ID, p.CPU, p.Memory, p.Monthly)
				}
			}
			return err
		}
		if len(command.Positionals) != 3 || command.Positionals[0] != "set" {
			return errors.New("use: paasta plan set PROJECT PLAN")
		}
		return action("PUT", "/api/projects/"+url.PathEscape(slug(command.Positionals[1]))+"/plan", map[string]string{"servicePlanId": command.Positionals[2]}, cfg)
	case "scale":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta scale PROJECT REPLICAS")
		}
		replicas, parseErr := strconv.Atoi(command.Positionals[1])
		if parseErr != nil {
			return errors.New("replicas must be a number")
		}
		return action("PUT", "/api/projects/"+url.PathEscape(slug(command.Positionals[0]))+"/scale", map[string]int{"replicas": replicas}, cfg)
	case "start", "stop":
		if len(command.Positionals) != 1 {
			return errors.New("project name is required")
		}
		replicas := 1
		if command.Command == "stop" {
			replicas = 0
		}
		return action("PUT", "/api/projects/"+url.PathEscape(slug(command.Positionals[0]))+"/scale", map[string]int{"replicas": replicas}, cfg)
	case "restart":
		if len(command.Positionals) != 1 {
			return errors.New("project name is required")
		}
		return action("POST", "/api/projects/"+url.PathEscape(slug(command.Positionals[0]))+"/restart", nil, cfg)
	case "volumes":
		return collection("/api/volumes", "volumes", cfg, command.Flags["json"] == "true")
	case "backups":
		return backups(cfg, command.Flags["json"] == "true")
	case "volume":
		if len(command.Positionals) < 1 {
			return errors.New("use: paasta volume create|resize|backup|snapshot|files|file|delete")
		}
		if command.Positionals[0] == "files" {
			if len(command.Positionals) != 2 {
				return errors.New("use: paasta volume files ID [--path /] [--json]")
			}
			return listVolumeFiles(command.Positionals[1], value(command.Flags, "path", "/"), command.Flags["json"] == "true", cfg)
		}
		if command.Positionals[0] == "file" {
			command.Positionals = command.Positionals[1:]
			return volumeFileCommand(command, cfg)
		}
		if command.Positionals[0] == "resize" {
			if len(command.Positionals) != 3 {
				return errors.New("use: paasta volume resize ID SIZE")
			}
			size, parseErr := strconv.Atoi(command.Positionals[2])
			if parseErr != nil || size < 1 {
				return errors.New("size must be a positive number of GB")
			}
			return action("PATCH", "/api/volumes/"+url.PathEscape(command.Positionals[1]), map[string]int{"size_gb": size}, cfg)
		}
		if command.Positionals[0] == "backup" || command.Positionals[0] == "snapshot" {
			if len(command.Positionals) != 2 {
				return fmt.Errorf("use: paasta volume %s ID", command.Positionals[0])
			}
			return action("POST", "/api/volumes/"+url.PathEscape(command.Positionals[1])+"/"+command.Positionals[0]+"s", nil, cfg)
		}
		if command.Positionals[0] == "delete" {
			if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
				return errors.New("use: paasta volume delete ID --yes")
			}
			return action("DELETE", "/api/volumes/"+url.PathEscape(command.Positionals[1]), nil, cfg)
		}
		if command.Positionals[0] != "create" || len(command.Positionals) != 2 {
			return errors.New("use: paasta volume create PROJECT --name NAME --offering ID --size GB --mount PATH [--billing payg|monthly]")
		}
		payload := map[string]any{"project": slug(command.Positionals[1]), "name": command.Flags["name"], "offering_id": command.Flags["offering"], "size_gb": command.Flags["size"], "mount_path": command.Flags["mount"], "billing_mode": value(command.Flags, "billing", "payg")}
		return action("POST", "/api/volumes", payload, cfg)
	case "backup":
		if len(command.Positionals) != 2 {
			return errors.New("use: paasta backup download|restore|delete ID")
		}
		operation, id := command.Positionals[0], command.Positionals[1]
		if operation == "download" {
			return downloadBackup(id, command.Flags["output"], command.Flags["overwrite"] == "true", cfg)
		}
		if (operation != "restore" && operation != "delete") || command.Flags["yes"] != "true" {
			return errors.New("use: paasta backup restore|delete ID --yes")
		}
		method, suffix := "DELETE", ""
		if operation == "restore" {
			method, suffix = "POST", "/restore"
		}
		return action(method, "/api/backups/"+url.PathEscape(id)+suffix, nil, cfg)
	case "snapshot":
		if len(command.Positionals) != 2 || command.Flags["yes"] != "true" {
			return errors.New("use: paasta snapshot restore|delete ID --yes")
		}
		operation, id := command.Positionals[0], command.Positionals[1]
		if operation != "restore" && operation != "delete" {
			return errors.New("use: paasta snapshot restore|delete ID --yes")
		}
		method, suffix := "DELETE", ""
		if operation == "restore" {
			method, suffix = "POST", "/restore"
		}
		return action(method, "/api/snapshots/"+url.PathEscape(id)+suffix, nil, cfg)
	case "databases":
		return collection("/api/databases", "databases", cfg, command.Flags["json"] == "true")
	case "database":
		return databaseCommand(command, cfg)
	case "notifications":
		return notifications(cfg, command.Flags["json"] == "true")
	case "notification":
		return notificationCommand(command, cfg)
	case "support":
		return supportCommand(command, cfg)
	case "cdn":
		return cdnCommand(command, cfg)
	case "domains":
		if len(command.Positionals) == 0 {
			return managedDomainCommand(command, cfg)
		}
		if len(command.Positionals) != 1 {
			return errors.New("use: paasta domains [--json] | domains PROJECT [--json]")
		}
		var result any
		if err := api("GET", "/api/projects/"+url.PathEscape(slug(command.Positionals[0]))+"/domains", nil, &result, cfg); err != nil {
			return err
		}
		return printJSON(result)
	case "domain":
		if len(command.Positionals) > 0 && map[string]bool{"quote": true, "register": true, "transfer": true, "renew": true, "restore": true, "info": true, "nameservers": true, "auto-renew": true, "transfer-lock": true, "transfer-code": true, "retry-order": true}[command.Positionals[0]] {
			return managedDomainCommand(command, cfg)
		}
		if len(command.Positionals) < 3 {
			return errors.New("use: paasta domain add|verify|delete PROJECT VALUE")
		}
		operation, projectName, target := command.Positionals[0], slug(command.Positionals[1]), command.Positionals[2]
		path := "/api/projects/" + url.PathEscape(projectName) + "/domains"
		switch operation {
		case "add":
			var result any
			if err := api("POST", path, map[string]string{"hostname": target}, &result, cfg); err != nil {
				return err
			}
			return printJSON(result)
		case "verify":
			return action("PUT", path, map[string]string{"id": target}, cfg)
		case "delete":
			if command.Flags["yes"] != "true" {
				return errors.New("domain deletion requires --yes")
			}
			return action("DELETE", path, map[string]string{"id": target}, cfg)
		default:
			return errors.New("use: paasta domain add|verify|delete")
		}
	case "topup":
		if len(command.Positionals) != 1 {
			return errors.New("amount is required")
		}
		amount, parseErr := strconv.Atoi(command.Positionals[0])
		if parseErr != nil {
			return errors.New("amount must be a number in toman")
		}
		var result struct {
			URL string `json:"url"`
		}
		if err := api("POST", "/api/billing/zibal/request", map[string]any{"amount": amount, "returnPath": "/billing"}, &result, cfg); err != nil {
			return err
		}
		fmt.Println(result.URL)
		if command.Flags["no-browser"] != "true" {
			_ = openBrowser(result.URL)
		}
		return nil
	case "delete":
		if len(command.Positionals) != 1 {
			return errors.New("project name is required")
		}
		if command.Flags["yes"] != "true" {
			return errors.New("deletion requires --yes")
		}
		return action("DELETE", "/api/projects/"+url.PathEscape(slug(command.Positionals[0])), nil, cfg)
	default:
		return fmt.Errorf("unknown command: %s (run paasta help)", command.Command)
	}
}

func main() {
	command := parse(os.Args[1:])
	if command.Command == "--version" {
		command.Command = "version"
	}
	if !(command.Command == "deploy" && command.Flags["dry-run"] == "true") {
		checkForUpdate(value(command.Flags, "server", defaultServer))
	}
	if err := run(command); err != nil {
		fmt.Fprintln(os.Stderr, color("31", "Error:")+" "+err.Error())
		os.Exit(1)
	}
}
