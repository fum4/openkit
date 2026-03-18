import { render, screen, userEvent } from "../../__test__/render";
import { ConfirmDialog } from "../ConfirmDialog";

describe("ConfirmDialog", () => {
  const defaultProps = {
    title: "Confirm Delete",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders title and children", () => {
    render(
      <ConfirmDialog {...defaultProps}>
        <p>Are you sure you want to delete this?</p>
      </ConfirmDialog>,
    );

    expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to delete this?")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog {...defaultProps} onConfirm={onConfirm}>
        Content
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog {...defaultProps} onCancel={onCancel}>
        Content
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders custom confirm label", () => {
    render(
      <ConfirmDialog {...defaultProps} confirmLabel="Remove">
        Content
      </ConfirmDialog>,
    );

    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("shows loading state with loading label", () => {
    render(
      <ConfirmDialog {...defaultProps} isLoading loadingConfirmLabel="Removing...">
        Content
      </ConfirmDialog>,
    );

    expect(screen.getByRole("button", { name: /Removing/i })).toBeDisabled();
  });

  it("disables cancel button during loading", () => {
    render(
      <ConfirmDialog {...defaultProps} isLoading>
        Content
      </ConfirmDialog>,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("hides cancel button when showCancelButton is false", () => {
    render(
      <ConfirmDialog {...defaultProps} showCancelButton={false}>
        Content
      </ConfirmDialog>,
    );

    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("does not call onConfirm when loading", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog {...defaultProps} onConfirm={onConfirm} isLoading>
        Content
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: /Deleting/i }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
