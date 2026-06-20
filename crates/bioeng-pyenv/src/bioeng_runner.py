"""Run a user script as ``__main__``, capturing rich output for the Output panel.

This wrapper is app infrastructure — the user's script never imports it. It runs
the target script exactly as ``python script.py`` would, with two additions that
mirror a Jupyter environment so that high-quality output needs no special library:

  * matplotlib figures are captured and shown in the Output panel instead of
    opening a window;
  * a builtin ``display()`` is provided (as in Jupyter/Colab) that renders any
    object through the *standard* rich-representation protocol — ``_repr_html_``,
    ``_repr_svg_``, ``_repr_png_``, ``_repr_mimebundle_``, and friends.

Each shown object is emitted as one sentinel-prefixed JSON line carrying a MIME
bundle; the host picks the richest representation it knows how to draw. All the
rendering logic lives in the host, not here — this only forwards standard
representations. Scripts stay portable: in a notebook ``display`` is already a
builtin, and elsewhere a script can ``from IPython.display import display``.
"""

import base64
import builtins
import io
import json
import runpy
import sys

SENTINEL = "\x1fBIOENG_DISPLAY\x1f"


def _emit(bundle):
    """Write a MIME bundle as one sentinel-prefixed JSON line."""
    if not bundle:
        return
    try:
        line = json.dumps({"data": bundle}, default=str, allow_nan=False)
    except (ValueError, TypeError):
        return
    sys.stdout.write(SENTINEL + line + "\n")
    sys.stdout.flush()


def _cell(value):
    # Keep cells JSON-safe: NaN/inf (pandas missing values) become null, and any
    # non-primitive (e.g. numpy scalars, dates) is stringified.
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    if isinstance(value, (str, int)):
        return value
    return str(value)


def _figure_png(figure):
    buffer = io.BytesIO()
    figure.savefig(buffer, format="png", dpi=144, bbox_inches="tight")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _dataframe_bundle(frame):
    # A pandas DataFrame, duck-typed so pandas stays optional. Emit the columns,
    # index, and cells as data the host renders as a table — or, when the frame
    # is shaped like a microplate, as a plate map. Plus a plain-text fallback.
    split = frame.to_dict("split")
    payload = {
        "columns": [str(column) for column in split.get("columns", [])],
        "index": [str(label) for label in split.get("index", [])],
        "data": [[_cell(value) for value in row] for row in split.get("data", [])],
    }
    return {"application/vnd.bioeng.dataframe+json": payload, "text/plain": repr(frame)}


def _mimebundle(obj):
    """The richest MIME bundle for ``obj`` via standard representation methods."""
    if type(obj).__name__ == "Figure" and hasattr(obj, "savefig"):
        return {"image/png": _figure_png(obj), "text/plain": "<Figure>"}

    if hasattr(obj, "to_dict") and hasattr(obj, "columns") and hasattr(obj, "index"):
        try:
            return _dataframe_bundle(obj)
        except Exception:
            pass

    if hasattr(obj, "_repr_mimebundle_"):
        try:
            result = obj._repr_mimebundle_()
            bundle = result[0] if isinstance(result, tuple) else result
            if bundle:
                return dict(bundle)
        except Exception:
            pass

    bundle = {}
    for method, mime in (
        ("_repr_html_", "text/html"),
        ("_repr_svg_", "image/svg+xml"),
        ("_repr_markdown_", "text/markdown"),
        ("_repr_latex_", "text/latex"),
        ("_repr_json_", "application/json"),
    ):
        renderer = getattr(obj, method, None)
        if renderer is None:
            continue
        try:
            value = renderer()
            if value:
                bundle[mime] = value
        except Exception:
            pass
    for method, mime in (("_repr_png_", "image/png"), ("_repr_jpeg_", "image/jpeg")):
        renderer = getattr(obj, method, None)
        if renderer is None:
            continue
        try:
            value = renderer()
            if value:
                bundle[mime] = value if isinstance(value, str) else base64.b64encode(value).decode("ascii")
        except Exception:
            pass

    bundle.setdefault("text/plain", repr(obj))
    return bundle


def display(*objects):
    """Render objects in the Output panel, mirroring Jupyter's ``display``."""
    for obj in objects:
        _emit(_mimebundle(obj))


def _install_matplotlib_capture():
    """Patch matplotlib to emit figures as image bundles; return a flush, or None."""
    try:
        import matplotlib
    except Exception:
        return None

    matplotlib.use("Agg", force=True)
    import matplotlib.pyplot as plt

    def emit_all():
        for number in plt.get_fignums():
            _emit({"image/png": _figure_png(plt.figure(number)), "text/plain": "<Figure>"})
        plt.close("all")

    # plt.show() conventionally means "render now"; capture and clear instead.
    plt.show = lambda *args, **kwargs: emit_all()
    return emit_all


def main():
    if len(sys.argv) < 2:
        print("bioeng_runner: no script provided", file=sys.stderr)
        return 2

    script = sys.argv[1]

    # Provide `display` the way notebook environments do, without an import.
    builtins.display = display
    emit_all = _install_matplotlib_capture()

    # Present the user script as the program: its own argv[0] and __main__.
    sys.argv = [script] + sys.argv[2:]
    try:
        runpy.run_path(script, run_name="__main__")
    finally:
        if emit_all is not None:
            # Capture figures built but never explicitly shown.
            emit_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())
