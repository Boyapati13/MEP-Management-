#!/usr/bin/env python3
"""
Senior Quantitative AI Geopolitical & Macroeconomic Sentiment Analyst
===================================================================
Scrapes live geopolitical risk and central bank policy news feeds, extracts
sentiment scores, and exports unified quantitative macro biases to gate
high-frequency scalping and portfolio trading systems.
"""

import os
import sys
import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Reconfigure terminal encoding for emojis
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

class MacroSentimentAnalyst:
    def __init__(self):
        # Premium news feeds from Google News RSS
        self.queries = {
            "geopolitics": "geopolitical+tension+OR+military+escalation+OR+ceasefire+financial+market",
            "central_bank": "federal+reserve+interest+rate+OR+inflation+hawkish+dovish",
            "energy_spikes": "crude+oil+price+supply+shock+OR+energy+crisis"
        }
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        
        # Output locations
        self.local_json = Path(__file__).resolve().parent / "macro_sentiment.json"
        
        # MetaQuotes Terminal Common folder (hot-reload for live EAs / python bots)
        self.common_dir = Path(os.environ.get("APPDATA", "")) / "MetaQuotes" / "Terminal" / "Common" / "Files"
        self.common_json = self.common_dir / "macro_sentiment.json"

    def fetch_rss_headlines(self, category: str, query: str) -> list:
        """Fetches live RSS feeds from Google News and extracts top headlines."""
        url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
        headlines = []
        try:
            req = urllib.request.Request(url, headers=self.headers)
            with urllib.request.urlopen(req, timeout=8.0) as resp:
                xml_data = resp.read()
            
            root = ET.fromstring(xml_data)
            for item in root.findall(".//item")[:10]:  # Analyze top 10 articles
                title = item.find("title").text
                pub_date = item.find("pubDate").text
                headlines.append({"title": title, "date": pub_date})
        except Exception as e:
            print(f"[MacroAnalyst] [ERROR] Failed to fetch {category} headlines: {e}")
        return headlines

    def perform_quantitative_scoring(self, headlines_by_cat: dict) -> dict:
        """
        Executes a senior quantitative linguistic rules-based sentiment mapping,
        extracting escalation risks, interest rate pressures, and supply chain impacts.
        """
        # Lexicons
        bull_haven_words = ["escalation", "war", "conflict", "sanctions", "strike", "tensions", "crisis", "disruption", "threat", "attacks", "strains"]
        bear_haven_words = ["ceasefire", "peace", "agreement", "de-escalation", "deal", "talks", "easing", "recovery", "stability"]
        
        hawkish_fed_words = ["hawkish", "rate hike", "hike", "sticky inflation", "tightening", "restrictive", "stronger inflation", "fed holds", "elevated rates"]
        dovish_fed_words = ["dovish", "rate cut", "cuts", "cooling inflation", "easing", "slowing economy", "soft landing", "pause", "recession fears"]

        energy_shock_words = ["oil spike", "supply shock", "crude price", "strait of hormuz", "energy crisis", "output cuts", "disruptions"]

        geopolitics_score = 0
        central_bank_score = 0
        energy_score = 0
        
        all_headlines = []
        
        # 1. Score Geopolitics
        for h in headlines_by_cat.get("geopolitics", []):
            t_low = h["title"].lower()
            all_headlines.append(h["title"])
            for w in bull_haven_words:
                if w in t_low: geopolitics_score += 1.5
            for w in bear_haven_words:
                if w in t_low: geopolitics_score -= 1.2

        # 2. Score Central Bank
        for h in headlines_by_cat.get("central_bank", []):
            t_low = h["title"].lower()
            all_headlines.append(h["title"])
            for w in hawkish_fed_words:
                if w in t_low: central_bank_score += 1.5
            for w in dovish_fed_words:
                if w in t_low: central_bank_score -= 1.2

        # 3. Score Energy Shocks
        for h in headlines_by_cat.get("energy_spikes", []):
            t_low = h["title"].lower()
            all_headlines.append(h["title"])
            for w in energy_shock_words:
                if w in t_low: energy_score += 1.5
            for w in bear_haven_words:
                if w in t_low: energy_score -= 1.0

        # Classify Geopolitical Threat Index
        risk_level = "LOW"
        if geopolitics_score >= 8.0 or energy_score >= 6.0:
            risk_level = "CRITICAL"
        elif geopolitics_score >= 4.5 or energy_score >= 3.5:
            risk_level = "HIGH"
        elif geopolitics_score >= 2.0 or energy_score >= 1.5:
            risk_level = "MEDIUM"

        # Determine macro bias per asset
        xau_bias = "NEUTRAL"
        nas_bias = "NEUTRAL"
        usd_bias = "NEUTRAL"

        # Gold Bias: Bullish under geopolitical risk or dovish fed; bearish under hawkish fed
        if risk_level in ["HIGH", "CRITICAL"]:
            xau_bias = "BULLISH"
        elif central_bank_score >= 4.0:
            xau_bias = "BEARISH"
        elif central_bank_score <= -3.0:
            xau_bias = "BULLISH"

        # Nasdaq Bias: Bearish under critical geopolitics or hawkish fed; bullish under dovish fed
        if risk_level == "CRITICAL" or central_bank_score >= 4.5:
            nas_bias = "BEARISH"
        elif risk_level == "LOW" and central_bank_score <= -3.0:
            nas_bias = "BULLISH"

        # USD Bias: Bullish under hawkish fed or critical geopolitics (safe haven flight)
        if central_bank_score >= 4.0 or risk_level == "CRITICAL":
            usd_bias = "BULLISH"
        elif central_bank_score <= -3.0:
            usd_bias = "BEARISH"

        # Map to specific symbols in our portfolio
        macro_bias = {
            "XAUUSD+": xau_bias,
            "NAS100": nas_bias,
            "EURUSD+": "BEARISH" if usd_bias == "BULLISH" else ("BULLISH" if usd_bias == "BEARISH" else "NEUTRAL"),
            "GBPUSD+": "BEARISH" if usd_bias == "BULLISH" else ("BULLISH" if usd_bias == "BEARISH" else "NEUTRAL")
        }

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "geopolitical_risk": risk_level,
            "geopolitics_raw_score": round(geopolitics_score, 2),
            "fed_raw_score": round(central_bank_score, 2),
            "energy_raw_score": round(energy_score, 2),
            "macro_bias": macro_bias,
            "recent_headlines": all_headlines[:8]  # Cache top 8 for UI telemetry
        }

    def analyze(self) -> dict:
        """Core execution pipeline to fetch headlines, run scoring, and export telemetry."""
        print("[MacroAnalyst] Spawning real-time geopolitical intelligence queries...")
        headlines_by_cat = {}
        for cat, query in self.queries.items():
            print(f" [Crawl] Querying Google News RSS for {cat}...")
            headlines_by_cat[cat] = self.fetch_rss_headlines(cat, query)
            
        report = self.perform_quantitative_scoring(headlines_by_cat)
        
        # Save to local directory
        try:
            self.local_json.write_text(json.dumps(report, indent=4, ensure_ascii=False), encoding="utf-8")
            print(f"[MacroAnalyst] [SUCCESS] Saved telemetry locally to: {self.local_json.name}")
        except Exception as e:
            print(f"[MacroAnalyst] [ERROR] Failed to save local JSON: {e}")
            
        # Save to MT5 Common files directory if available
        if self.common_dir.exists():
            try:
                self.common_json.write_text(json.dumps(report, indent=4, ensure_ascii=False), encoding="utf-8")
                print(f"[MacroAnalyst] [SUCCESS] Hot-reloaded MT5 Common telemetry at: {self.common_json}")
            except Exception as e:
                print(f"[MacroAnalyst] [ERROR] Failed to save Common JSON: {e}")
                
        return report

def main():
    print("=" * 60)
    print("      SENIOR QUANTITATIVE MACRO SENTIMENT ANALYST (v1.0)")
    print("=" * 60)
    analyst = MacroSentimentAnalyst()
    report = analyst.analyze()
    
    print("\n" + "=" * 60)
    print("                 LIVE GEOPOLITICAL REPORT")
    print("=" * 60)
    print(f"Generated at       : {report['generated_at']}")
    print(f"Geopolitical Risk  : {report['geopolitical_risk']}")
    print(f"Scores (Geo/Fed/En): {report['geopolitics_raw_score']} / {report['fed_raw_score']} / {report['energy_raw_score']}")
    print("\nQuantitative Asset Biases:")
    for sym, bias in report["macro_bias"].items():
        arrow = "🟢 BULLISH" if bias == "BULLISH" else ("🔴 BEARISH" if bias == "BEARISH" else "⚪ NEUTRAL")
        print(f"  - {sym:<10}: {arrow}")
        
    print("\nKey Headlines Monitored:")
    for idx, h in enumerate(report["recent_headlines"][:5]):
        print(f"  {idx+1}. {h}")
    print("=" * 60)

if __name__ == "__main__":
    main()
