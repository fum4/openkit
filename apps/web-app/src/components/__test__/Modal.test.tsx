import { render, screen, userEvent } from "../../__test__/render";
import { Modal } from "../Modal";

describe("Modal", () => {
  it("renders title and children", () => {
    render(
      <Modal title="Test Modal" onClose={() => {}}>
        <p>Modal content</p>
      </Modal>,
    );

    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByText("Modal content")).toBeInTheDocument();
  });

  it("renders footer when provided", () => {
    render(
      <Modal title="Test" onClose={() => {}} footer={<button>Save</button>}>
        Content
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <Modal title="Test" onClose={onClose}>
        Content
      </Modal>,
    );

    const closeButtons = screen.getAllByRole("button");
    // The close button has the X icon
    await user.click(closeButtons[0]);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides close button when showCloseButton is false", () => {
    render(
      <Modal title="Test" onClose={() => {}} showCloseButton={false}>
        Content
      </Modal>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("calls onClose on backdrop click when closeOnBackdrop is true", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    const { container } = render(
      <Modal title="Test" onClose={onClose} closeOnBackdrop={true}>
        Content
      </Modal>,
    );

    // The backdrop is the first fixed inset-0 div
    const backdrop = container.querySelector(".fixed.inset-0");
    if (backdrop) await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("renders as form when onSubmit is provided", () => {
    render(
      <Modal title="Form Modal" onClose={() => {}} onSubmit={() => {}}>
        <input />
      </Modal>,
    );

    expect(document.querySelector("form")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(
      <Modal title="Test" onClose={() => {}} icon={<span data-testid="icon">★</span>}>
        Content
      </Modal>,
    );

    expect(screen.getByText("★")).toBeInTheDocument();
  });
});
