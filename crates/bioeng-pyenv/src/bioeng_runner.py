"""Run a user script as ``__main__`` with matplotlib figures captured as images.

Invoked as ``python bioeng_runner.py <user_script.py>``. The host (Bio Eng
Studio) recognizes figure lines on stdout by their sentinel prefix and renders
them in the output panel.

The wrapper forces matplotlib's non-interactive ``Agg`` backend, executes the
target script in a ``__main__`` namespace so it behaves exactly as if run
directly, and emits each figure as a base64 PNG data URL prefixed with the
sentinel. It degrades to a plain run when matplotlib is not installed.
"""

import base64
import io
import runpy
import sys

SENTINEL = "\x1fBIOENG_FIGURE\x1f"


def _install_matplotlib_capture():
    """Patch matplotlib to emit figures as sentinel-prefixed data URLs.

    Returns a callable that flushes any open figures, or ``None`` when
    matplotlib is unavailable.
    """
    try:
        import matplotlib
    except Exception:
        return None

    matplotlib.use("Agg", force=True)
    import matplotlib.pyplot as plt

    def emit(fig):
        buffer = io.BytesIO()
        try:
            fig.savefig(buffer, format="png", dpi=144, bbox_inches="tight")
        except Exception:
            return
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        # One line per figure: the host splits on newlines and strips SENTINEL.
        sys.stdout.write(f"{SENTINEL}data:image/png;base64,{encoded}\n")
        sys.stdout.flush()

    def emit_all():
        for number in plt.get_fignums():
            emit(plt.figure(number))
        plt.close("all")

    # plt.show() conventionally means "render now"; capture and clear instead.
    plt.show = lambda *args, **kwargs: emit_all()
    return emit_all


def main():
    if len(sys.argv) < 2:
        print("bioeng_runner: no script provided", file=sys.stderr)
        return 2

    script = sys.argv[1]
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
