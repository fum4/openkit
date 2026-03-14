"""Type stubs for ctypes FFI bindings to Go logger library."""

import ctypes

class _CLib:
    """Type stub for the loaded C library."""

    LoggerNew: ctypes._CFuncPtr
    LoggerInfo: ctypes._CFuncPtr
    LoggerWarn: ctypes._CFuncPtr
    LoggerError: ctypes._CFuncPtr
    LoggerDebug: ctypes._CFuncPtr
    LoggerSuccess: ctypes._CFuncPtr
    LoggerPlain: ctypes._CFuncPtr
    LoggerFree: ctypes._CFuncPtr

lib: _CLib
