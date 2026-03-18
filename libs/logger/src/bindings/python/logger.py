import atexit
import json
import os
from typing import Any, Literal, Optional

try:
    from .bindings import lib
except ImportError:
    from bindings import lib

LogLevel = Literal["debug", "info", "warn", "error"]
LogFormat = Literal["dev", "prod"]


class Logger:
    """Logger that calls Go shared library via ctypes."""

    def __init__(
        self,
        system: str,
        subsystem: Optional[str] = None,
        level: Optional[LogLevel] = None,
        format: Optional[LogFormat] = None,
    ):
        self._system = system
        self._subsystem = subsystem
        self._level = level
        self._format = format

        env_level = os.getenv("LOG_LEVEL") or level or "info"
        env_format = format or ("prod" if os.getenv("NODE_ENV") == "production" else "dev")

        self.handle = lib.LoggerNew(
            system.encode("utf-8"),
            (subsystem or "").encode("utf-8"),
            env_level.encode("utf-8"),
            env_format.encode("utf-8"),
        )

        # Register cleanup
        atexit.register(self._cleanup)

    def __getattr__(self, name: str) -> "Logger":
        """
        Create a subsystem logger on-the-fly.

        Example:
            logger.nats.info("Message")  # Creates AI | NATS logger
            logger.db.error("Error")     # Creates AI | DB logger
        """
        # Avoid infinite recursion - only intercept subsystem names
        # Don't intercept private attributes, methods, or properties set in __init__
        if (name.startswith('_') or
            name in ('handle', 'info', 'warn', 'error', 'debug', 'success', 'started', 'plain', '_cleanup')):
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

        # Create a new logger with the subsystem
        return Logger(self._system, name.upper(), self._level, self._format)

    def _build_context(self, domain: str, context: dict[str, Any]) -> str:
        merged = {"domain": domain, **context}
        return json.dumps(merged)

    def info(self, message: str, *, domain: str, **context: Any) -> None:
        """Log info message. ``domain`` is required to namespace logs by feature area."""
        lib.LoggerInfo(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, context).encode("utf-8"),
        )

    def warn(self, message: str, *, domain: str, **context: Any) -> None:
        """Log warning message. ``domain`` is required to namespace logs by feature area."""
        lib.LoggerWarn(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, context).encode("utf-8"),
        )

    def error(self, message: str, *, domain: str, **context: Any) -> None:
        """Log error message. ``domain`` is required to namespace logs by feature area."""
        lib.LoggerError(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, context).encode("utf-8"),
        )

    def debug(self, message: str, *, domain: str, **context: Any) -> None:
        """Log debug message. ``domain`` is required to namespace logs by feature area."""
        lib.LoggerDebug(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, context).encode("utf-8"),
        )

    def success(self, message: str, *, domain: str, **context: Any) -> None:
        """Log success message (green bullet, INFO level, status: success). ``domain`` is required."""
        ctx = {**context, "status": "success"}
        lib.LoggerSuccess(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, ctx).encode("utf-8"),
        )

    def started(self, message: str, *, domain: str, **context: Any) -> None:
        """Log started message (INFO level, status: started). ``domain`` is required."""
        ctx = {**context, "status": "started"}
        lib.LoggerStarted(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, ctx).encode("utf-8"),
        )

    def plain(self, message: str, *, domain: str, **context: Any) -> None:
        """Log plain message (no prefix, no color, INFO level). ``domain`` is required."""
        lib.LoggerPlain(
            self.handle,
            message.encode("utf-8"),
            self._build_context(domain, context).encode("utf-8"),
        )

    @staticmethod
    def set_sink(server_url: str, project_name: str) -> None:
        """Configure the Go logger to POST entries to a server endpoint."""
        lib.LoggerSetSink(server_url.encode("utf-8"), project_name.encode("utf-8"))

    @staticmethod
    def close_sink() -> None:
        """Flush remaining entries and stop the sink."""
        lib.LoggerCloseSink()

    def _cleanup(self) -> None:
        """Cleanup logger on exit."""
        if self.handle:
            lib.LoggerFree(self.handle)
