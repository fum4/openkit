import ctypes
import platform
from pathlib import Path

# Load shared library
system = platform.system()
if system == "Darwin":
    lib_name = "liblogger.dylib"
elif system == "Linux":
    lib_name = "liblogger.so"
else:
    raise RuntimeError(f"Unsupported platform: {system}")

lib_path = Path(__file__).parent.parent / lib_name
lib = ctypes.CDLL(str(lib_path))

# Define function signatures
lib.LoggerNew.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerNew.restype = ctypes.c_int

lib.LoggerInfo.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerInfo.restype = None

lib.LoggerWarn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerWarn.restype = None

lib.LoggerError.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerError.restype = None

lib.LoggerDebug.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerDebug.restype = None

lib.LoggerSuccess.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerSuccess.restype = None

lib.LoggerPlain.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_char_p]
lib.LoggerPlain.restype = None

lib.LoggerFree.argtypes = [ctypes.c_int]
lib.LoggerFree.restype = None
