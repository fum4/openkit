---
name: testing
description: Principles and patterns for writing effective tests with Vitest and React Testing Library. Use during implementation for test structure guidance, choosing test patterns, and deciding testing strategies. Emphasizes testing user behavior, not implementation details.
---

# Testing Principles (Vitest + React Testing Library)

Principles and patterns for writing effective TypeScript + React tests.

## When to Use

- During implementation (tests + code in parallel)
- When testing strategy is unclear
- When structuring component or hook tests
- When choosing between test patterns

## Testing Philosophy

**Test user behavior, not implementation details**

- Test what users see and do
- Use accessible queries (getByRole, getByLabelText)
- Avoid testing internal state or methods
- Focus on public API

**Prefer real implementations over mocks**

- Use MSW (Mock Service Worker) for API mocking
- Use real hooks and contexts
- Test components with actual dependencies
- Integration-style tests over unit tests

**Coverage targets**

- Pure components/hooks: 100% coverage
- Container components: Integration tests for user flows
- Custom hooks: Test all branches and edge cases

## Test Integrity

**Tests are the most important code in this codebase.** They are the safety net for refactoring and bug prevention.

- **Do not modify existing tests lightly.** If a test fails, first verify whether the test caught a real bug before changing it.
- Changing a test to make it pass defeats the purpose — investigate first.
- One behavior per `it()` — each test tests exactly one thing.
- Name tests as behavior specs — `it('returns error when branch name contains spaces')`.
- Arrange-Act-Assert structure with blank lines between sections.

## Workflow

### 1. Identify What to Test

**Pure Components/Hooks (Leaf types)**:

- No external dependencies
- Predictable output for given input
- Test all branches, edge cases, errors
- Aim for 100% coverage

Examples:

- Button, ToggleSwitch, Modal (presentational components)
- useDebounce, useLocalStorage (utility hooks)
- Validation functions, formatters

**Container Components (Orchestrating types)**:

- Coordinate multiple components
- Manage state and side effects
- Test user workflows, not implementation
- Integration tests with real dependencies

Examples:

- CreateWorktreeModal, ConfigurationPanel
- Feature-level components with data fetching

### 2. Choose Test Structure

**describe/it blocks - Use when:**

- Testing complex user flows
- Need setup/teardown per test
- Testing different scenarios

**React Testing Library Suite - Always use:**

- render() for components (use custom render from `test/render.tsx`)
- screen queries (getByRole, getByText, etc.)
- userEvent for interactions
- waitFor for async operations

### 3. Write Tests Next to Implementation

```typescript
// src/components/Modal.tsx
// src/components/Modal.test.tsx
```

### 4. Use Real Implementations

```typescript
// Use custom render wrapper with providers
import { render, screen, userEvent } from "../test/render";
import { Modal } from "./Modal";

it("renders title and children", () => {
  render(
    <Modal title="Test Modal" onClose={() => {}}>
      <p>Modal content</p>
    </Modal>,
  );

  expect(screen.getByText("Test Modal")).toBeInTheDocument();
  expect(screen.getByText("Modal content")).toBeInTheDocument();
});
```

### 5. Avoid Common Pitfalls

- No arbitrary timeouts (use waitFor/findBy)
- No testing implementation details (state, internal methods)
- No shallow rendering (use full render)
- No excessive mocking (use MSW for APIs)
- No getByTestId unless absolutely necessary (use accessibility queries)

## Test Patterns

### Pattern 1: Component with User Interactions

```typescript
import { render, screen, userEvent } from "../test/render";

describe("ConfirmDialog", () => {
  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog title="Delete?" onConfirm={onConfirm} onCancel={() => {}}>
        Are you sure?
      </ConfirmDialog>,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

### Pattern 2: Testing Custom Hooks

```typescript
import { renderHook, waitFor } from "@testing-library/react";

describe("useDebounce", () => {
  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 500));

    expect(result.current).toBe("initial");
  });
});
```

### Pattern 3: Testing with Context

```typescript
import { render, screen } from "../test/render";

// Custom render already wraps with QueryClientProvider
// Add more providers as needed
it("shows content when data is loaded", async () => {
  render(<MyComponent />);

  expect(await screen.findByText(/loaded data/i)).toBeInTheDocument();
});
```

### Pattern 4: Async Operations (waitFor)

```typescript
it("loads and displays data", async () => {
  render(<UserProfile userId="123" />);

  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  expect(screen.getByText(/john doe/i)).toBeInTheDocument();
});
```

## Testing Queries Priority

Use queries in this order (from most to least preferred):

1. **getByRole** - Best for accessibility
2. **getByLabelText** - Good for form fields
3. **getByPlaceholderText** - When label isn't available
4. **getByText** - For non-interactive elements
5. **getByTestId** - Last resort only

## Mocking

### Vitest Mocks

```typescript
// Mock a module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Spy on a function
const onClose = vi.fn();

// Fake timers
vi.useFakeTimers();
vi.advanceTimersByTime(500);
vi.useRealTimers();
```

### MSW for API Mocking

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.get("/api/worktrees", () => {
    return HttpResponse.json({ worktrees: [] });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Key Principles

See reference.md for detailed principles:

- Test user behavior, not implementation
- Use accessibility queries (getByRole)
- Prefer real implementations over mocks
- MSW for API mocking
- waitFor for async, avoid arbitrary timeouts
- 100% coverage for pure components/hooks
- Integration tests for user flows

## Coverage Strategy

**Pure components (100% coverage)**:

- All prop combinations
- All user interactions
- All conditional renders
- Error states

**Container components (integration tests)**:

- Complete user flows
- Error scenarios
- Loading states
- Success paths

**Custom hooks (100% coverage)**:

- All return values
- All branches
- Error handling
- Edge cases

See reference.md for complete testing patterns and examples.
