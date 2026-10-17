"""
OCTO-Pro embedded DeerFlow harness.

The DeerFlow harness internally uses relative imports like
'from deerflow.config import ...' — those work fine as long
as 'deerflow' is importable (which it is, since ROOT is on sys.path).
"""
from pathlib import Path

DEERFLOW_DIR = Path(__file__).resolve().parent
