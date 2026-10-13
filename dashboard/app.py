#!/usr/bin/env python3
"""
dashboard/app.py
────────────────
TennisMaster-AI: Tactical Coach & Match Intelligence Dashboard.

Features:
1. Hawkeye Electronic Line Calling (ELC) Review:
   - Interactive court plot of all bounces with margins (cm) and ITF Rule 12 calls.
   - Filterable data table for close calls, In, Out, and Touching Line.
2. 3D Ballistic Trajectory & Shot Speed Explorer:
   - Interactive 3D court wireframe with free-flight parabolic arcs.
   - Apex height, duration, and radar-equivalent speed telemetry.
3. Player Tactical Telemetry & Heatmaps:
   - Distance run (m), peak sprint speed (km/h), and lateral/depth ratios.
   - Court Zone Occupancy (Baseline, Transition, Net) and 2D spatial heatmaps.
4. Shot Breakdown & Match Timeline:
   - Forehand / Backhand / Serve / Volley / Smash / Lob distributions.

Usage:
  python dashboard/app.py
  python dashboard/app.py --port 8050 --host 0.0.0.0
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dash import Dash, Input, Output, dcc, html


# ── Court Dimensions (ITF Standard in Metres) ─────────────────────────────────
COURT_LENGTH = 23.77
DOUBLES_WIDTH = 10.97
SINGLES_WIDTH = 8.23
ALLEY = (DOUBLES_WIDTH - SINGLES_WIDTH) / 2.0  # 1.37
NET_Y = 11.885
SERVICE_FAR_Y = 5.48
SERVICE_NEAR_Y = 18.29
CENTER_X = DOUBLES_WIDTH / 2.0


def create_court_2d_figure(hawkeye_calls: list[dict] | None = None) -> go.Figure:
    """Creates a high-precision 2D ITF Tennis Court figure with bounce markers."""
    fig = go.Figure()

    # Outer doubles boundary
    fig.add_shape(type="rect", x0=0, y0=0, x1=DOUBLES_WIDTH, y1=COURT_LENGTH,
                  line=dict(color="#FFFFFF", width=3), fillcolor="#1E3A8A", opacity=0.3)

    # Singles lines
    fig.add_shape(type="rect", x0=ALLEY, y0=0, x1=DOUBLES_WIDTH - ALLEY, y1=COURT_LENGTH,
                  line=dict(color="#FFFFFF", width=2))

    # Service lines
    fig.add_shape(type="line", x0=ALLEY, y0=SERVICE_FAR_Y, x1=DOUBLES_WIDTH - ALLEY, y1=SERVICE_FAR_Y,
                  line=dict(color="#FFFFFF", width=2))
    fig.add_shape(type="line", x0=ALLEY, y0=SERVICE_NEAR_Y, x1=DOUBLES_WIDTH - ALLEY, y1=SERVICE_NEAR_Y,
                  line=dict(color="#FFFFFF", width=2))

    # Center service line
    fig.add_shape(type="line", x0=CENTER_X, y0=SERVICE_FAR_Y, x1=CENTER_X, y1=SERVICE_NEAR_Y,
                  line=dict(color="#FFFFFF", width=2))

    # Net line
    fig.add_shape(type="line", x0=-0.5, y0=NET_Y, x1=DOUBLES_WIDTH + 0.5, y1=NET_Y,
                  line=dict(color="#E2E8F0", width=4, dash="solid"))

    # Plot Hawkeye Bounces
    if hawkeye_calls:
        in_bounces = [b for b in hawkeye_calls if b.get("decision") == "IN"]
        touch_bounces = [b for b in hawkeye_calls if b.get("decision") == "TOUCHING_LINE"]
        out_bounces = [b for b in hawkeye_calls if b.get("decision") == "OUT"]

        def _scatter_group(b_list, name, color, symbol):
            if not b_list:
                return
            xs = [b["court_position_m"][0] for b in b_list]
            ys = [b["court_position_m"][1] for b in b_list]
            texts = [
                f"Frame: {b.get('frame')}<br>Call: {b.get('decision')}<br>Margin: {b.get('margin_cm'):+.1f} cm<br>Line: {b.get('nearest_line')}"
                for b in b_list
            ]
            fig.add_trace(go.Scatter(
                x=xs, y=ys, mode="markers+text", name=name,
                marker=dict(size=14, color=color, symbol=symbol, line=dict(color="#FFFFFF", width=2)),
                text=[f"f{b.get('frame')}" for b in b_list],
                textposition="top center",
                textfont=dict(color=color, size=11),
                hovertext=texts, hoverinfo="text"
            ))

        _scatter_group(in_bounces, "IN (Safe)", "#22C55E", "circle")
        _scatter_group(touch_bounces, "TOUCHING LINE (In)", "#F59E0B", "diamond")
        _scatter_group(out_bounces, "OUT", "#EF4444", "x")

    fig.update_layout(
        title="Hawkeye Line Calling 2D Court Overview (ITF Rule 12)",
        xaxis=dict(range=[-1, DOUBLES_WIDTH + 1], showgrid=False, zeroline=False, title="Court Width (m)"),
        yaxis=dict(range=[-1, COURT_LENGTH + 1], showgrid=False, zeroline=False, scaleanchor="x", scaleratio=1, title="Court Length (m)"),
        plot_bgcolor="#0F172A",
        paper_bgcolor="#1E293B",
        font=dict(color="#F8FAFC"),
        margin=dict(l=40, r=40, t=50, b=40),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
    )
    return fig


def create_trajectory_3d_figure(trajectories: list[dict] | None = None) -> go.Figure:
    """Creates an interactive 3D WebGL Court Wireframe with ballistic flight arcs."""
    fig = go.Figure()

    # Court floor perimeter
    floor_x = [0, DOUBLES_WIDTH, DOUBLES_WIDTH, 0, 0]
    floor_y = [0, 0, COURT_LENGTH, COURT_LENGTH, 0]
    floor_z = [0, 0, 0, 0, 0]
    fig.add_trace(go.Scatter3d(
        x=floor_x, y=floor_y, z=floor_z, mode="lines",
        line=dict(color="#FFFFFF", width=4), name="Court Perimeter"
    ))

    # Net mesh 3D
    net_z = [0, 1.0, 1.0, 0, 0]
    net_x = [0, 0, DOUBLES_WIDTH, DOUBLES_WIDTH, 0]
    net_y = [NET_Y, NET_Y, NET_Y, NET_Y, NET_Y]
    fig.add_trace(go.Scatter3d(
        x=net_x, y=net_y, z=net_z, mode="lines",
        line=dict(color="#94A3B8", width=5), name="Tennis Net (1.0m)"
    ))

    # Flight trajectories
    if trajectories:
        colors = px.colors.qualitative.Plotly
        for idx, traj in enumerate(trajectories):
            pts = traj.get("points", [])
            if not pts:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            zs = [p[2] for p in pts]
            speed = traj.get("speed_kmh")
            label = f"f{traj.get('start_frame')}→f{traj.get('end_frame')}"
            if speed:
                label += f" ({speed:.0f} km/h)"
            col = colors[idx % len(colors)]

            fig.add_trace(go.Scatter3d(
                x=xs, y=ys, z=zs, mode="lines+markers",
                marker=dict(size=3, color=col),
                line=dict(color=col, width=6),
                name=label,
                hoverinfo="text",
                hovertext=[f"Frame {traj.get('start_frame')}<br>Speed: {speed} km/h<br>Apex: {traj.get('apex_height_m')} m" for _ in pts]
            ))

    fig.update_layout(
        scene=dict(
            xaxis=dict(title="X (m)", backgroundcolor="#0F172A", gridcolor="#334155"),
            yaxis=dict(title="Y (m)", backgroundcolor="#0F172A", gridcolor="#334155"),
            zaxis=dict(title="Height Z (m)", range=[0, 7], backgroundcolor="#0F172A", gridcolor="#334155"),
            aspectmode="manual",
            aspectratio=dict(x=1, y=2.2, z=0.7),
            camera=dict(eye=dict(x=1.6, y=-1.5, z=1.2))
        ),
        paper_bgcolor="#1E293B",
        font=dict(color="#F8FAFC"),
        title="3D Parabolic Trajectory Reconstruction (Free-Flight Ballistics)",
        margin=dict(l=20, r=20, t=50, b=20)
    )
    return fig


def create_tactical_comparison_figures(tactical_data: dict | None = None):
    """Creates tactical radar/bar telemetry comparing Player 1 and Player 2."""
    p1 = tactical_data.get("player_1", {}) if tactical_data else {}
    p2 = tactical_data.get("player_2", {}) if tactical_data else {}

    # 1. Bar Chart: Distance & Sprint Speed
    metrics = ["Distance Run (m)", "Peak Sprint (km/h)", "Avg Speed (km/h)"]
    val_p1 = [p1.get("total_distance_m", 0), p1.get("peak_speed_kmh", 0), p1.get("average_speed_kmh", 0)]
    val_p2 = [p2.get("total_distance_m", 0), p2.get("peak_speed_kmh", 0), p2.get("average_speed_kmh", 0)]

    bar_fig = go.Figure(data=[
        go.Bar(name="Player 1", x=metrics, y=val_p1, marker_color="#38BDF8"),
        go.Bar(name="Player 2", x=metrics, y=val_p2, marker_color="#F43F5E")
    ])
    bar_fig.update_layout(
        barmode="group",
        title="Physical Load & Movement Speed Telemetry",
        plot_bgcolor="#0F172A", paper_bgcolor="#1E293B",
        font=dict(color="#F8FAFC"),
        margin=dict(l=40, r=40, t=50, b=40)
    )

    # 2. Court Zone Distribution Donut Charts
    zones = ["Baseline Zone", "Transition Zone", "Net Approach"]
    z_p1 = [p1.get("baseline_time_pct", 70), p1.get("transition_time_pct", 20), p1.get("net_time_pct", 10)]
    z_p2 = [p2.get("baseline_time_pct", 65), p2.get("transition_time_pct", 25), p2.get("net_time_pct", 10)]

    pie_fig = go.Figure()
    pie_fig.add_trace(go.Pie(
        labels=zones, values=z_p1, name="Player 1", hole=0.5, domain=dict(x=[0, 0.48]),
        marker=dict(colors=["#3B82F6", "#F59E0B", "#10B981"])
    ))
    pie_fig.add_trace(go.Pie(
        labels=zones, values=z_p2, name="Player 2", hole=0.5, domain=dict(x=[0.52, 1.0]),
        marker=dict(colors=["#3B82F6", "#F59E0B", "#10B981"])
    ))
    pie_fig.update_layout(
        title="Court Zone Occupancy Distribution (P1 Left vs P2 Right)",
        paper_bgcolor="#1E293B", font=dict(color="#F8FAFC"),
        annotations=[
            dict(text="P1", x=0.22, y=0.5, font_size=20, font_color="#38BDF8", showarrow=False),
            dict(text="P2", x=0.78, y=0.5, font_size=20, font_color="#F43F5E", showarrow=False)
        ],
        margin=dict(l=20, r=20, t=50, b=20)
    )
    return bar_fig, pie_fig


def load_latest_match_data(stats_dir: str = "output/stats") -> tuple[dict, list[dict], pd.DataFrame | None]:
    """Scans and loads the latest summary.json, trajectory3d.json, and stats.csv."""
    p = Path(stats_dir)
    if not p.exists():
        return _get_demo_data()

    summaries = sorted(p.glob("summary_*.json"), key=os.path.getmtime, reverse=True)
    if not summaries:
        return _get_demo_data()

    latest_summary_file = summaries[0]
    with open(latest_summary_file, encoding="utf-8") as f:
        summary = json.load(f)

    # Load 3D trajectory
    trajectories = []
    traj_files = sorted(p.glob("trajectory3d_*.json"), key=os.path.getmtime, reverse=True)
    if traj_files:
        with open(traj_files[0], encoding="utf-8") as f:
            trajectories = json.load(f).get("segments", [])

    # Load CSV
    csv_df = None
    csv_files = sorted(p.glob("stats_*.csv"), key=os.path.getmtime, reverse=True)
    if csv_files:
        try:
            csv_df = pd.read_csv(csv_files[0])
        except Exception:
            pass

    return summary, trajectories, csv_df


def _get_demo_data():
    """Generates broadcast-grade demonstration dataset if no runs exist yet."""
    summary = {
        "generated_at": "Demo Match Sample",
        "total_shots_p1": 7, "total_shots_p2": 6,
        "avg_shot_speed_p1_kmh": 128.5, "avg_shot_speed_p2_kmh": 122.0,
        "serve_avg_flight_speed_kmh": 178.4,
        "hawkeye": {
            "total_bounces_evaluated": 5,
            "in_count": 4, "out_count": 1, "line_touch_count": 1,
            "calls": [
                {"frame": 28, "decision": "IN", "margin_cm": -42.5, "nearest_line": "service_line", "court_position_m": [4.2, 16.5], "margin_text": "SERVICE IN by 42.5 cm"},
                {"frame": 54, "decision": "TOUCHING_LINE", "margin_cm": -1.2, "nearest_line": "singles_sideline", "court_position_m": [1.4, 21.8], "margin_text": "IN (1.2 cm on line)"},
                {"frame": 82, "decision": "IN", "margin_cm": -65.0, "nearest_line": "baseline", "court_position_m": [5.5, 3.2], "margin_text": "IN by 65.0 cm"},
                {"frame": 110, "decision": "IN", "margin_cm": -18.4, "nearest_line": "baseline", "court_position_m": [7.8, 22.9], "margin_text": "IN by 18.4 cm"},
                {"frame": 138, "decision": "OUT", "margin_cm": 6.8, "nearest_line": "baseline", "court_position_m": [3.6, -0.07], "margin_text": "OUT by 6.8 cm"},
            ]
        },
        "tactical_telemetry": {
            "player_1": {"total_distance_m": 84.6, "average_speed_kmh": 9.4, "peak_speed_kmh": 18.2, "baseline_time_pct": 74.0, "transition_time_pct": 18.0, "net_time_pct": 8.0, "lateral_distance_m": 58.2, "depth_distance_m": 26.4},
            "player_2": {"total_distance_m": 92.1, "average_speed_kmh": 10.1, "peak_speed_kmh": 19.5, "baseline_time_pct": 68.0, "transition_time_pct": 22.0, "net_time_pct": 10.0, "lateral_distance_m": 61.5, "depth_distance_m": 30.6}
        },
        "shot_classification": {"shots": 13, "types": {"Serve": 1, "Forehand": 7, "Backhand": 4, "Volley": 1}}
    }
    # Demo 3D Parabola
    trajectories = []
    for s_f, e_f, sp, apex in [(12, 28, 178.4, 2.4), (32, 54, 134.0, 1.8), (60, 82, 126.5, 1.9), (88, 110, 119.2, 1.7), (115, 138, 131.0, 2.1)]:
        t_arr = np.linspace(0, 1, 20)
        xs = np.linspace(4.5 + np.random.uniform(-1, 1), 5.0 + np.random.uniform(-2, 2), 20)
        ys = np.linspace(23.0 if s_f == 12 else 2.0, 16.5 if s_f == 12 else 22.0, 20)
        zs = 4 * apex * t_arr * (1 - t_arr)
        trajectories.append({
            "start_frame": s_f, "end_frame": e_f, "speed_kmh": sp,
            "apex_height_m": apex, "points": [[float(xs[i]), float(ys[i]), float(zs[i])] for i in range(20)]
        })
    return summary, trajectories, None


# ── Initialize Dash Application ───────────────────────────────────────────────
app = Dash(__name__, title="TennisMaster-AI Tactical Dashboard", suppress_callback_exceptions=True)

summary, trajectories, stats_df = load_latest_match_data()
hawkeye_calls = summary.get("hawkeye", {}).get("calls", [])
tactical_telemetry = summary.get("tactical_telemetry", {})

app.layout = html.Div(
    style={"backgroundColor": "#090D16", "color": "#F8FAFC", "fontFamily": "'Inter', 'Segoe UI', sans-serif", "minHeight": "100vh", "padding": "24px"},
    children=[
        # Header Bar
        html.Div(
            style={"display": "flex", "justifyContent": "space-between", "alignItems": "center", "marginBottom": "24px", "borderBottom": "1px solid #1E293B", "paddingBottom": "16px"},
            children=[
                html.Div([
                    html.H1("🎾 TennisMaster-AI: Tactical Coach & Match Intelligence", style={"margin": "0 0 6px 0", "fontSize": "26px", "fontWeight": "700", "background": "linear-gradient(90deg, #38BDF8, #818CF8)", "WebkitBackgroundClip": "text", "WebkitTextFillColor": "transparent"}),
                    html.P("End-to-End Broadcast Analysis: TrackNetV3 • ResNet-50 Court • Hawkeye ELC • 3D Ballistics", style={"margin": "0", "color": "#94A3B8", "fontSize": "13px"})
                ]),
                html.Div(
                    style={"background": "#1E293B", "padding": "8px 16px", "borderRadius": "8px", "border": "1px solid #334155", "fontSize": "13px"},
                    children=[html.Span("Match Session: ", style={"color": "#94A3B8"}), html.Strong(summary.get("generated_at", "Live Session"), style={"color": "#38BDF8"})]
                )
            ]
        ),

        # KPI Metric Cards
        html.Div(
            style={"display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(210px, 1fr))", "gap": "16px", "marginBottom": "24px"},
            children=[
                html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                    html.P("P1 Total Shots", style={"margin": "0", "color": "#94A3B8", "fontSize": "12px"}),
                    html.H3(f"{summary.get('total_shots_p1', 0)} shots", style={"margin": "8px 0 0 0", "color": "#38BDF8", "fontSize": "22px"})
                ]),
                html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                    html.P("P2 Total Shots", style={"margin": "0", "color": "#94A3B8", "fontSize": "12px"}),
                    html.H3(f"{summary.get('total_shots_p2', 0)} shots", style={"margin": "8px 0 0 0", "color": "#F43F5E", "fontSize": "22px"})
                ]),
                html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                    html.P("Avg Shot Speed (P1)", style={"margin": "0", "color": "#94A3B8", "fontSize": "12px"}),
                    html.H3(f"{summary.get('avg_shot_speed_p1_kmh', 0.0)} km/h", style={"margin": "8px 0 0 0", "color": "#10B981", "fontSize": "22px"})
                ]),
                html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                    html.P("Peak Serve Speed", style={"margin": "0", "color": "#94A3B8", "fontSize": "12px"}),
                    html.H3(f"{summary.get('serve_avg_flight_speed_kmh', 0.0)} km/h", style={"margin": "8px 0 0 0", "color": "#F59E0B", "fontSize": "22px"})
                ]),
                html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                    html.P("Hawkeye Bounces", style={"margin": "0", "color": "#94A3B8", "fontSize": "12px"}),
                    html.H3(f"{summary.get('hawkeye', {}).get('total_bounces_evaluated', len(hawkeye_calls))} calls", style={"margin": "8px 0 0 0", "color": "#A855F7", "fontSize": "22px"})
                ]),
            ]
        ),

        # Main Navigation Tabs
        dcc.Tabs(
            id="main-tabs",
            value="tab-hawkeye",
            colors={"border": "#334155", "primary": "#38BDF8", "background": "#111827"},
            children=[
                dcc.Tab(label="🎯 Hawkeye Line Calling (ITF Rule 12)", value="tab-hawkeye", style={"color": "#94A3B8"}, selected_style={"color": "#38BDF8", "fontWeight": "600"}),
                dcc.Tab(label="🚀 3D Trajectory & Speed Arcs", value="tab-3d", style={"color": "#94A3B8"}, selected_style={"color": "#38BDF8", "fontWeight": "600"}),
                dcc.Tab(label="🏃 Tactical Telemetry & Load", value="tab-tactical", style={"color": "#94A3B8"}, selected_style={"color": "#38BDF8", "fontWeight": "600"}),
                dcc.Tab(label="📊 Shot Type & Rally Breakdown", value="tab-shots", style={"color": "#94A3B8"}, selected_style={"color": "#38BDF8", "fontWeight": "600"}),
            ]
        ),

        html.Div(id="tab-content", style={"marginTop": "20px"})
    ]
)


@app.callback(Output("tab-content", "children"), Input("main-tabs", "value"))
def render_tab(tab_name: str):
    if tab_name == "tab-hawkeye":
        fig_2d = create_court_2d_figure(hawkeye_calls)

        # Table rows
        table_rows = []
        for c in hawkeye_calls:
            color = "#22C55E" if c.get("decision") == "IN" else ("#F59E0B" if c.get("decision") == "TOUCHING_LINE" else "#EF4444")
            table_rows.append(html.Tr([
                html.Td(f"Frame {c.get('frame')}", style={"padding": "10px", "borderBottom": "1px solid #1F2937"}),
                html.Td(html.Span(c.get("decision"), style={"color": color, "fontWeight": "600", "background": "#1E293B", "padding": "4px 8px", "borderRadius": "4px"}), style={"padding": "10px", "borderBottom": "1px solid #1F2937"}),
                html.Td(f"{c.get('margin_cm'):+.1f} cm", style={"padding": "10px", "borderBottom": "1px solid #1F2937", "color": color}),
                html.Td(c.get("nearest_line", "").replace("_", " ").title(), style={"padding": "10px", "borderBottom": "1px solid #1F2937", "color": "#CBD5E1"}),
                html.Td(f"({c.get('court_position_m', [0, 0])[0]:.2f}m, {c.get('court_position_m', [0, 0])[1]:.2f}m)", style={"padding": "10px", "borderBottom": "1px solid #1F2937", "color": "#94A3B8"}),
                html.Td(c.get("margin_text", ""), style={"padding": "10px", "borderBottom": "1px solid #1F2937", "color": "#E2E8F0"}),
            ]))

        return html.Div([
            html.Div(
                style={"display": "grid", "gridTemplateColumns": "1.2fr 1fr", "gap": "20px"},
                children=[
                    html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                        dcc.Graph(figure=fig_2d, style={"height": "650px"})
                    ]),
                    html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937", "overflowX": "auto"}, children=[
                        html.H3("Hawkeye Official Electronic Review Table", style={"marginTop": "0", "fontSize": "18px", "color": "#38BDF8"}),
                        html.P("Evaluation conforming to ITF Rule 12 (Ball Touches Line). Margin represents distance to outer edge.", style={"color": "#94A3B8", "fontSize": "13px"}),
                        html.Table(
                            style={"width": "100%", "borderCollapse": "collapse", "fontSize": "13px", "textAlign": "left"},
                            children=[
                                html.Thead(html.Tr([
                                    html.Th("Frame", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                    html.Th("Ruling", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                    html.Th("Margin", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                    html.Th("Line", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                    html.Th("Position (X,Y)", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                    html.Th("Audit Note", style={"padding": "10px", "color": "#94A3B8", "borderBottom": "1px solid #334155"}),
                                ])),
                                html.Tbody(table_rows)
                            ]
                        )
                    ])
                ]
            )
        ])

    elif tab_name == "tab-3d":
        fig_3d = create_trajectory_3d_figure(trajectories)
        return html.Div(style={"background": "#111827", "padding": "20px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
            html.Div([
                html.H3("3D Ballistic Parabolic Arc Reconstruction", style={"margin": "0 0 6px 0", "color": "#38BDF8"}),
                html.P("Recovering vertical Z dimension from floor-anchored contacts and bounces using closed-form gravity kinematics.", style={"margin": "0 0 16px 0", "color": "#94A3B8", "fontSize": "13px"})
            ]),
            dcc.Graph(figure=fig_3d, style={"height": "700px"})
        ])

    elif tab_name == "tab-tactical":
        bar_fig, pie_fig = create_tactical_comparison_figures(tactical_telemetry)
        return html.Div([
            html.Div(
                style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "20px"},
                children=[
                    html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                        dcc.Graph(figure=bar_fig, style={"height": "480px"})
                    ]),
                    html.Div(style={"background": "#111827", "padding": "16px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
                        dcc.Graph(figure=pie_fig, style={"height": "480px"})
                    ]),
                ]
            )
        ])

    elif tab_name == "tab-shots":
        shot_stats = summary.get("shot_classification", {}).get("types", {"Forehand": 7, "Backhand": 4, "Serve": 1, "Volley": 1})
        shot_fig = px.pie(
            names=list(shot_stats.keys()), values=list(shot_stats.values()),
            title="Shot Type Distribution (Physically Evidenced + Pose Upgraded)",
            color_discrete_sequence=px.colors.qualitative.Pastel
        )
        shot_fig.update_layout(paper_bgcolor="#1E293B", font=dict(color="#F8FAFC"))

        return html.Div(style={"background": "#111827", "padding": "20px", "borderRadius": "12px", "border": "1px solid #1F2937"}, children=[
            dcc.Graph(figure=shot_fig, style={"height": "500px"})
        ])

    return html.Div("Select a tab")


def main():
    parser = argparse.ArgumentParser(description="Run TennisMaster-AI Tactical Dashboard")
    parser.add_argument("--port", type=int, default=8050, help="Port to run Dashboard on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address")
    parser.add_argument("--stats-dir", type=str, default="output/stats", help="Directory containing summary and stats")
    args = parser.parse_args()

    print(f"🎾 Launching Tactical Coach Dashboard on http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
