"""Type stubs for logger module with full autocomplete support."""

from typing import Any, Literal, Optional, Protocol

LogLevel = Literal["debug", "info", "warn", "error"]
LogFormat = Literal["dev", "prod"]

class _LoggerProtocol(Protocol):
    """Protocol defining the logger interface for type checking."""

    def info(self, message: str, *, domain: str, **context: Any) -> None:
        """Log info message. ``domain`` namespaces logs by feature area."""
        ...

    def warn(self, message: str, *, domain: str, **context: Any) -> None:
        """Log warning message. ``domain`` namespaces logs by feature area."""
        ...

    def error(self, message: str, *, domain: str, **context: Any) -> None:
        """Log error message. ``domain`` namespaces logs by feature area."""
        ...

    def debug(self, message: str, *, domain: str, **context: Any) -> None:
        """Log debug message. ``domain`` namespaces logs by feature area."""
        ...

    def success(self, message: str, *, domain: str, **context: Any) -> None:
        """Log success message (green bullet, INFO level)."""
        ...

    def plain(self, message: str, *, domain: str, **context: Any) -> None:
        """Log plain message (no prefix, no color, INFO level)."""
        ...

class Logger(_LoggerProtocol):
    """
    Logger that calls Go shared library via ctypes.

    Supports dynamic subsystem creation via attribute access:
        logger.nats.info("message", domain="nats")
        logger.db.error("error", domain="db")

    All log methods require a ``domain`` keyword argument to namespace logs
    by feature area (e.g. "GitHub", "auto-launch", "project-switch").
    """

    handle: int
    _system: str
    _subsystem: Optional[str]
    _level: Optional[LogLevel]
    _format: Optional[LogFormat]

    def __init__(
        self,
        system: str,
        subsystem: Optional[str] = None,
        level: Optional[LogLevel] = None,
        format: Optional[LogFormat] = None,
    ) -> None: ...

    def info(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log an info-level message.

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.info("User logged in", domain="auth", user_id=123)
        """
        ...

    def warn(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log a warning-level message.

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.warn("Rate limit approaching", domain="api", current=95)
        """
        ...

    def error(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log an error-level message.

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.error("Connection failed", domain="db", error=str(e))
        """
        ...

    def debug(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log a debug-level message.

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.debug("Query executed", domain="db", query="SELECT *")
        """
        ...

    def success(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log a success message (green bullet prefix, INFO level).

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.success("Initialized", domain="setup", path="/dev/project")
        """
        ...

    def plain(self, message: str, *, domain: str, **context: Any) -> None:
        """
        Log a plain message (no prefix, no color, INFO level).

        Args:
            message: The log message
            domain: Feature area namespace (required)
            **context: Additional context as keyword arguments (serialized to JSON)

        Example:
            logger.plain("Available: init, add, task", domain="cli")
        """
        ...

    def __getattr__(self, name: str) -> Logger:
        """
        Create a subsystem logger dynamically.

        Args:
            name: Subsystem name (will be uppercased)

        Returns:
            A new Logger instance with the subsystem set

        Example:
            nats_logger = logger.nats
            nats_logger.info("Connected", domain="nats")
        """
        ...

    def _cleanup(self) -> None:
        """Cleanup logger on exit (called automatically via atexit)."""
        ...
