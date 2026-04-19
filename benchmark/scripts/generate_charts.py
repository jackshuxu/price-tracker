#!/usr/bin/env python3
"""
generate_charts.py — Benchmark Visualization

Reads all JSON result files and writes publication-ready figures to
benchmark/results/charts/.

Figures produced:
  fig1_scalability.pdf        Throughput vs. number of nodes (line chart)
  fig2_component_latency.pdf  Per-component latency by corpus  (bar chart)
  fig3_component_throughput.pdf  Per-component throughput      (bar chart)
  fig4_m0_vs_m6.pdf           M0 vs. M6 query speedup         (bar chart)
  fig5_search_latency.pdf     Search endpoint latency profiles (bar chart)

Usage:
  python3 benchmark/scripts/generate_charts.py
"""

import json
import os
import sys

import matplotlib
matplotlib.use("Agg")                       # headless / no display needed
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

# ── Paths ─────────────────────────────────────────────────────────────────────

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(SCRIPT_DIR, "..", "results")
CHARTS_DIR  = os.path.join(RESULTS_DIR, "charts")
os.makedirs(CHARTS_DIR, exist_ok=True)

def results_path(*parts):
    return os.path.join(RESULTS_DIR, *parts)

def chart_path(name):
    return os.path.join(CHARTS_DIR, name)

# ── Style ─────────────────────────────────────────────────────────────────────

ORANGE = "#E87722"
BLUE   = "#3A7ABF"
TEAL   = "#4EAAA0"

CORPUS1_COLOR = ORANGE
CORPUS2_COLOR = BLUE

plt.rcParams.update({
    "font.family":       "serif",
    "font.size":         10,
    "axes.titlesize":    11,
    "axes.labelsize":    10,
    "legend.fontsize":   9,
    "xtick.labelsize":   9,
    "ytick.labelsize":   9,
    "figure.dpi":        150,
    "axes.spines.top":   False,
    "axes.spines.right": False,
    "axes.grid":         True,
    "grid.linestyle":    "--",
    "grid.alpha":        0.4,
})

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_json(rel_path):
    full = results_path(rel_path)
    if not os.path.exists(full):
        print(f"  [skip] {rel_path} not found")
        return None
    with open(full) as f:
        return json.load(f)

def save(fig, name):
    p = chart_path(name)
    fig.savefig(p, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {os.path.relpath(p, SCRIPT_DIR)}")

# ── Fig 1: Scalability sweep ─────────────────────────────────────────────────

def fig_scalability():
    data = load_json("scalability_sweep/results.json")
    if not data or not data.get("rows"):
        return

    rows = [r for r in data["rows"] if "error" not in r]
    if not rows:
        return

    nodes       = [r["nodes"]                               for r in rows]
    crawler_k   = [r["crawler"]["throughputSnapshotsPerSec"] / 1000 for r in rows]
    indexer_k   = [r["indexer"]["throughputDocsPerSec"]     / 1000  for r in rows]
    all_k       = [r["allComponents"]["throughputDocsPerSec"]/ 1000 for r in rows]

    fig, ax = plt.subplots(figsize=(6, 3.2))

    mk = dict(markersize=6, linewidth=1.5)
    ax.plot(nodes, crawler_k, color=BLUE,   marker="^",  label="Crawler",        **mk)
    ax.plot(nodes, indexer_k, color=BLUE,   marker="^",  label="Indexer",
            linestyle="--", alpha=0.7,       **mk)
    ax.plot(nodes, all_k,     color=ORANGE, marker="^",  label="All components", **mk)

    ax.set_xlabel("Number of nodes")
    ax.set_ylabel("Throughput (K docs / sec)")
    ax.set_xticks(nodes)
    ax.legend(frameon=False, loc="upper left")
    ax.yaxis.set_major_formatter(ticker.FormatStrFormatter("%.0f"))

    fig.tight_layout()
    save(fig, "fig1_scalability.pdf")
    save(fig, "fig1_scalability.png")   # also write PNG for quick preview

def fig_scalability_query():
    """Secondary scalability view: query RPS vs nodes."""
    data = load_json("scalability_sweep/results.json")
    if not data or not data.get("rows"):
        return

    rows = [r for r in data["rows"] if "error" not in r and r.get("search")]
    if not rows:
        return

    nodes = [r["nodes"] for r in rows]
    rps   = [r["search"]["throughputRps"] for r in rows]
    p95   = [r["search"]["latencyMs"]["p95"] if r["search"]["latencyMs"] else 0
             for r in rows]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8, 3.2))

    ax1.plot(nodes, rps, color=ORANGE, marker="^", linewidth=1.5, markersize=6)
    ax1.set_xlabel("Number of nodes")
    ax1.set_ylabel("Query throughput (rps)")
    ax1.set_xticks(nodes)
    ax1.set_title("Query throughput")

    ax2.plot(nodes, p95, color=BLUE, marker="^", linewidth=1.5, markersize=6)
    ax2.set_xlabel("Number of nodes")
    ax2.set_ylabel("p95 latency (ms)")
    ax2.set_xticks(nodes)
    ax2.set_title("Query p95 latency")

    fig.tight_layout()
    save(fig, "fig1b_scalability_query.pdf")
    save(fig, "fig1b_scalability_query.png")

# ── Fig 2: Component latency bar chart ───────────────────────────────────────

def fig_component_latency():
    data = load_json("m6_component_perf.latest.json")
    if not data or not data.get("corpora") or len(data["corpora"]) < 2:
        return

    c1, c2 = data["corpora"][0], data["corpora"][1]

    # Storage: use average of put-p95 and get-p95 as a single "storage" bar
    def storage_p95(c):
        return (c["storage"]["put"]["latencyMs"]["p95"]
              + c["storage"]["get"]["latencyMs"]["p95"]) / 2

    components = ["Crawler", "Indexer", "Storage", "Search"]
    c1_vals = [
        c1["crawler"]["avgLatencyMsPerSnapshot"],
        c1["indexer"]["avgLatencyMsPerDoc"],
        storage_p95(c1),
        c1["search"]["latencyMs"]["p95"],
    ]
    c2_vals = [
        c2["crawler"]["avgLatencyMsPerSnapshot"],
        c2["indexer"]["avgLatencyMsPerDoc"],
        storage_p95(c2),
        c2["search"]["latencyMs"]["p95"],
    ]

    x = np.arange(len(components))
    width = 0.35

    fig, ax = plt.subplots(figsize=(6.5, 3.5))

    b1 = ax.bar(x - width/2, c1_vals, width, label=c1["corpus"]["label"],
                color=CORPUS1_COLOR, alpha=0.9)
    b2 = ax.bar(x + width/2, c2_vals, width, label=c2["corpus"]["label"],
                color=CORPUS2_COLOR, alpha=0.9)

    # Reference dashed line at the larger corpus mean
    ref_line = np.mean([v for v in c2_vals if v > 0])
    ax.axhline(ref_line, color="black", linestyle="--", linewidth=0.8, alpha=0.5)

    ax.set_ylabel("Latency (ms)")
    ax.set_xlabel("System Components")
    ax.set_xticks(x)
    ax.set_xticklabels(components)
    ax.legend(frameon=False)
    ax.set_ylim(bottom=0)

    # Annotate bars with value labels
    for rect in list(b1) + list(b2):
        h = rect.get_height()
        if h > 0:
            ax.text(rect.get_x() + rect.get_width() / 2, h + 0.05,
                    f"{h:.2f}", ha="center", va="bottom", fontsize=7)

    fig.tight_layout()
    save(fig, "fig2_component_latency.pdf")
    save(fig, "fig2_component_latency.png")

# ── Fig 3: Component throughput bar chart ─────────────────────────────────────

def fig_component_throughput():
    data = load_json("m6_component_perf.latest.json")
    if not data or not data.get("corpora") or len(data["corpora"]) < 2:
        return

    c1, c2 = data["corpora"][0], data["corpora"][1]

    components = ["Crawler\n(snapshots/sec)", "Indexer\n(docs/sec)",
                  "Storage put\n(ops/sec)", "Storage get\n(ops/sec)",
                  "Search\n(rps)"]
    c1_vals = [
        c1["crawler"]["throughputSnapshotsPerSec"],
        c1["indexer"]["throughputDocsPerSec"],
        c1["storage"]["put"]["throughputOpsPerSec"],
        c1["storage"]["get"]["throughputOpsPerSec"],
        c1["search"]["throughputRps"],
    ]
    c2_vals = [
        c2["crawler"]["throughputSnapshotsPerSec"],
        c2["indexer"]["throughputDocsPerSec"],
        c2["storage"]["put"]["throughputOpsPerSec"],
        c2["storage"]["get"]["throughputOpsPerSec"],
        c2["search"]["throughputRps"],
    ]

    x = np.arange(len(components))
    width = 0.35

    fig, ax = plt.subplots(figsize=(8, 3.8))

    ax.bar(x - width/2, c1_vals, width, label=c1["corpus"]["label"],
           color=CORPUS1_COLOR, alpha=0.9)
    ax.bar(x + width/2, c2_vals, width, label=c2["corpus"]["label"],
           color=CORPUS2_COLOR, alpha=0.9)

    ax.set_ylabel("Throughput")
    ax.set_xlabel("System Components")
    ax.set_xticks(x)
    ax.set_xticklabels(components, fontsize=8)
    ax.legend(frameon=False)
    ax.set_ylim(bottom=0)

    fig.tight_layout()
    save(fig, "fig3_component_throughput.pdf")
    save(fig, "fig3_component_throughput.png")

# ── Fig 4: M0 vs M6 speedup ───────────────────────────────────────────────────

def fig_m0_vs_m6():
    data = load_json("m0_vs_m6.latest.json")
    if not data:
        return

    m0_rps = data.get("m0", {}).get("throughput", {}).get("queryRps", 0)
    endpoints = data.get("m6", {}).get("endpointSnapshot", [])
    if not endpoints:
        return

    # Assemble bar data
    labels = ["M0\n(baseline)"] + [e["name"] for e in endpoints]
    values = [m0_rps] + [e["throughputRps"] for e in endpoints]
    colors = ["#888888"] + [ORANGE if i % 2 == 0 else BLUE
                             for i in range(len(endpoints))]

    fig, ax = plt.subplots(figsize=(7, 3.5))

    bars = ax.bar(labels, values, color=colors, alpha=0.9, width=0.6)

    # Annotate with values
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                f"{val:.0f}", ha="center", va="bottom", fontsize=8)

    ax.set_ylabel("Throughput (rps)")
    ax.set_xlabel("System / Endpoint")
    ax.set_ylim(bottom=0)

    speedup = data.get("comparison", {}).get("speedupX")
    if speedup:
        ax.set_title(f"M0 vs M6 — {speedup:.0f}× query speedup")

    fig.tight_layout()
    save(fig, "fig4_m0_vs_m6.pdf")
    save(fig, "fig4_m0_vs_m6.png")

# ── Fig 5: Search endpoint latency profiles ────────────────────────────────────

def fig_search_latency():
    data = load_json("m6_characterization.latest.json")
    if not data or "endpoints" not in data:
        return

    eps = data["endpoints"]
    names = list(eps.keys())
    p50  = [eps[n]["latencyMs"]["p50"] for n in names]
    p95  = [eps[n]["latencyMs"]["p95"] for n in names]
    p99  = [eps[n]["latencyMs"]["p99"] for n in names]

    x = np.arange(len(names))
    width = 0.25

    fig, ax = plt.subplots(figsize=(7, 3.5))

    ax.bar(x - width,   p50, width, label="p50", color=TEAL,   alpha=0.9)
    ax.bar(x,           p95, width, label="p95", color=ORANGE, alpha=0.9)
    ax.bar(x + width,   p99, width, label="p99", color=BLUE,   alpha=0.9)

    ax.set_ylabel("Latency (ms)")
    ax.set_xlabel("Endpoint")
    ax.set_xticks(x)
    ax.set_xticklabels(names, fontsize=8)
    ax.legend(frameon=False)
    ax.set_ylim(bottom=0)

    fig.tight_layout()
    save(fig, "fig5_search_latency.pdf")
    save(fig, "fig5_search_latency.png")

# ── Fig 6: Search endpoint throughput ─────────────────────────────────────────

def fig_search_throughput():
    data = load_json("m6_characterization.latest.json")
    if not data or "endpoints" not in data:
        return

    eps    = data["endpoints"]
    names  = list(eps.keys())
    values = [eps[n]["throughputRps"] for n in names]
    colors = [ORANGE if i % 2 == 0 else BLUE for i in range(len(names))]

    fig, ax = plt.subplots(figsize=(6, 3.2))

    bars = ax.bar(names, values, color=colors, alpha=0.9, width=0.5)
    for bar, val in zip(bars, values):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                f"{val:.0f}", ha="center", va="bottom", fontsize=8)

    ax.set_ylabel("Throughput (rps)")
    ax.set_xlabel("Endpoint")
    ax.set_ylim(bottom=0)

    fig.tight_layout()
    save(fig, "fig6_search_throughput.pdf")
    save(fig, "fig6_search_throughput.png")

# ── Fig 7: Correctness summary table as figure ────────────────────────────────

def fig_correctness():
    data = load_json("m6_correctness.latest.json")
    if not data:
        return

    tests = data.get("tests", [])
    if not tests:
        return

    ids    = [t["id"] for t in tests]
    passed = [1 if t["pass"] else 0 for t in tests]
    colors = [TEAL if p else "#CC3333" for p in passed]

    fig, ax = plt.subplots(figsize=(7, 2.5))

    bars = ax.barh(ids[::-1], [1]*len(ids), color=colors[::-1], alpha=0.85, height=0.6)
    ax.set_xlim(0, 1.3)
    ax.set_xlabel("")
    ax.set_xticks([])
    ax.set_title(f"Correctness: {sum(passed)}/{len(tests)} tests passed")

    for i, (bar, t) in enumerate(zip(bars, tests[::-1])):
        label = "PASS" if t["pass"] else "FAIL"
        ax.text(1.02, bar.get_y() + bar.get_height()/2,
                label, va="center", fontsize=8,
                color=TEAL if t["pass"] else "#CC3333", fontweight="bold")

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_visible(False)

    fig.tight_layout()
    save(fig, "fig7_correctness.pdf")
    save(fig, "fig7_correctness.png")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"[charts] output directory: {CHARTS_DIR}\n")

    charts = [
        ("fig1_scalability",         fig_scalability),
        ("fig1b_scalability_query",  fig_scalability_query),
        ("fig2_component_latency",   fig_component_latency),
        ("fig3_component_throughput",fig_component_throughput),
        ("fig4_m0_vs_m6",           fig_m0_vs_m6),
        ("fig5_search_latency",      fig_search_latency),
        ("fig6_search_throughput",   fig_search_throughput),
        ("fig7_correctness",         fig_correctness),
    ]

    for name, fn in charts:
        print(f"[charts] generating {name}...")
        try:
            fn()
        except Exception as exc:
            print(f"  ERROR: {exc}")

    print(f"\n[charts] done — {CHARTS_DIR}")

if __name__ == "__main__":
    main()
