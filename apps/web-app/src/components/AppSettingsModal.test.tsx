import { render, screen, userEvent, waitFor } from "../test/render";
import { AppSettingsModal } from "./AppSettingsModal";

describe("AppSettingsModal", () => {
  const defaultProps = {
    onClose: vi.fn(),
  };

  const mockElectronAPI = {
    getPreferences: vi.fn(async () => ({
      basePort: 6969,
      setupPreference: "ask" as const,
      autoDownloadUpdates: true,
      devMode: false,
      devModeRepoPath: "",
    })),
    updatePreferences: vi.fn(async () => {}),
    detectOpenkitRepo: vi.fn(async (): Promise<string | null> => null),
    selectDevRepoFolder: vi.fn(async (): Promise<string | null> => null),
  };

  beforeEach(() => {
    defaultProps.onClose.mockClear();
    mockElectronAPI.getPreferences.mockClear();
    mockElectronAPI.updatePreferences.mockClear();

    Object.defineProperty(window, "electronAPI", {
      value: mockElectronAPI,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "electronAPI", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("renders form fields after loading preferences", async () => {
    render(<AppSettingsModal {...defaultProps} />);

    expect(screen.getByRole("heading", { name: "App Settings" })).toBeInTheDocument();

    await waitFor(() => {
      expect(mockElectronAPI.getPreferences).toHaveBeenCalled();
    });

    expect(screen.getByText("Base Server Port")).toBeInTheDocument();
    expect(screen.getByText("New Project Setup")).toBeInTheDocument();
    expect(screen.getByText("Auto-download Updates")).toBeInTheDocument();
    expect(screen.getByText("Dev Mode")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(6969);
    expect(screen.getByRole("combobox")).toHaveValue("ask");
    expect(screen.getByRole("button", { name: "Auto-download updates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
  });

  it("disables Save when no changes have been made", async () => {
    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  it("enables Save after changing the base port", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveValue(6969);
    });

    const portInput = screen.getByRole("spinbutton");
    await user.clear(portInput);
    await user.type(portInput, "7070");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves preferences and closes modal on successful save", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveValue(6969);
    });

    const portInput = screen.getByRole("spinbutton");
    await user.tripleClick(portInput);
    await user.keyboard("8080");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockElectronAPI.updatePreferences).toHaveBeenCalledWith({
        basePort: 8080,
        setupPreference: "ask",
        autoDownloadUpdates: true,
        devMode: false,
        devModeRepoPath: "",
      });
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes modal when Cancel is clicked", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it("enables Save after toggling auto-download updates", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toHaveValue(6969);
    });

    await user.click(screen.getByRole("button", { name: "Auto-download updates" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("enables Save after changing setup preference", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveValue("ask");
    });

    await user.selectOptions(screen.getByRole("combobox"), "auto");

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("enables Save after toggling dev mode", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Dev mode" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows repo path input when dev mode is enabled", async () => {
    const user = userEvent.setup();

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    });

    // Repo path input should not be visible when dev mode is off
    expect(screen.queryByPlaceholderText("/path/to/openkit")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dev mode" }));

    // Now the repo path input should appear (after detection completes)
    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/openkit")).toBeInTheDocument();
    });
  });

  it("auto-detects repo path when enabling dev mode", async () => {
    const user = userEvent.setup();
    mockElectronAPI.detectOpenkitRepo.mockResolvedValue("/detected/path");

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    });

    // Toggling dev mode on should auto-trigger detection
    await user.click(screen.getByRole("button", { name: "Dev mode" }));

    await waitFor(() => {
      expect(mockElectronAPI.detectOpenkitRepo).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/openkit")).toHaveValue("/detected/path");
    });
  });

  it("calls selectDevRepoFolder when Browse is clicked", async () => {
    const user = userEvent.setup();
    mockElectronAPI.selectDevRepoFolder.mockResolvedValue("/selected/folder");

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    await user.click(screen.getByTitle("Browse"));

    await waitFor(() => {
      expect(mockElectronAPI.selectDevRepoFolder).toHaveBeenCalled();
    });

    expect(screen.getByPlaceholderText("/path/to/openkit")).toHaveValue("/selected/folder");
  });

  it("includes dev mode fields when saving", async () => {
    const user = userEvent.setup();
    mockElectronAPI.detectOpenkitRepo.mockResolvedValue("/detected/repo");

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    });

    // Enable dev mode — auto-detects repo path
    await user.click(screen.getByRole("button", { name: "Dev mode" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("/path/to/openkit")).toHaveValue("/detected/repo");
    });

    // Save
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockElectronAPI.updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          devMode: true,
          devModeRepoPath: "/detected/repo",
        }),
      );
    });
  });

  it("loads existing dev mode preferences", async () => {
    mockElectronAPI.getPreferences.mockResolvedValue({
      basePort: 6969,
      setupPreference: "ask" as const,
      autoDownloadUpdates: true,
      devMode: true,
      devModeRepoPath: "/existing/repo/path",
    });

    render(<AppSettingsModal {...defaultProps} />);

    await waitFor(() => {
      // When dev mode is already on, the repo path input should be visible
      expect(screen.getByPlaceholderText("/path/to/openkit")).toHaveValue("/existing/repo/path");
    });
  });
});
