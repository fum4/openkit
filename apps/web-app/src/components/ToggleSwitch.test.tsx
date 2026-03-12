import { render, screen, userEvent } from "../test/render";
import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("renders as a button when interactive", () => {
    render(<ToggleSwitch checked={false} />);

    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("renders as a span when non-interactive", () => {
    render(<ToggleSwitch checked={false} interactive={false} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onToggle when clicked", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(<ToggleSwitch checked={false} onToggle={onToggle} />);

    await user.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("does not call onToggle when disabled", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();

    render(<ToggleSwitch checked={false} onToggle={onToggle} disabled />);

    await user.click(screen.getByRole("button"));

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders with title attribute", () => {
    render(<ToggleSwitch checked={true} title="Enable feature" />);

    expect(screen.getByRole("button")).toHaveAttribute("title", "Enable feature");
  });

  it("renders with aria-label", () => {
    render(<ToggleSwitch checked={false} ariaLabel="Toggle notifications" />);

    expect(screen.getByRole("button", { name: "Toggle notifications" })).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<ToggleSwitch checked={false} disabled />);

    expect(screen.getByRole("button")).toBeDisabled();
  });
});
