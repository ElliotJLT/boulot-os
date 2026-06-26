#!/usr/bin/env python3
"""
Boulot Companies Intelligence Layer
Ingests company data from multiple sources into a single queryable SQLite database.
Sources: Sifted 100, LiveLocationData CSV, manual additions.
"""

import sqlite3
import csv
import re
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).parent / "companies.db"
CSV_PATH = Path(__file__).parent / "companies.csv"
SIFTED_PATH = Path(__file__).parent / "sifted-100-2026.md"


def create_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DROP TABLE IF EXISTS companies")
    c.execute("""
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sector TEXT,
            sub_sector TEXT,
            location TEXT,
            founded INTEGER,
            employees INTEGER,
            funding_amount REAL,
            funding_currency TEXT DEFAULT '£',
            funding_round TEXT,
            revenue REAL,
            profitable TEXT,
            ai_native INTEGER DEFAULT 0,
            cagr_2yr REAL,
            website TEXT,
            linkedin TEXT,
            twitter TEXT,
            founder_1_name TEXT,
            founder_1_linkedin TEXT,
            founder_2_name TEXT,
            founder_2_linkedin TEXT,
            extra_sectors TEXT,
            source TEXT NOT NULL,
            date_added TEXT,
            sifted_rank INTEGER
        )
    """)
    c.execute("CREATE INDEX idx_sector ON companies(sector)")
    c.execute("CREATE INDEX idx_location ON companies(location)")
    c.execute("CREATE INDEX idx_source ON companies(source)")
    c.execute("CREATE INDEX idx_funding_round ON companies(funding_round)")
    c.execute("CREATE INDEX idx_ai_native ON companies(ai_native)")
    c.execute("CREATE INDEX idx_employees ON companies(employees)")
    conn.commit()
    return conn


def parse_funding(val):
    """Parse funding values like '42.7', '10,195', 'PND' -> float or None"""
    if not val or val.strip() in ('PND', '', '-'):
        return None
    val = val.replace(',', '').strip()
    try:
        return float(val)
    except ValueError:
        return None


def ingest_sifted(conn):
    """Parse the Sifted 100 markdown table into the DB."""
    c = conn.cursor()
    text = SIFTED_PATH.read_text()

    # Find the main table
    lines = text.split('\n')
    in_table = False
    count = 0

    for line in lines:
        if '| # |' in line:
            in_table = True
            continue
        if in_table and line.startswith('|---'):
            continue
        if in_table and line.startswith('|'):
            cols = [col.strip() for col in line.split('|')[1:-1]]
            if len(cols) < 12:
                continue

            rank = int(cols[0]) if cols[0].isdigit() else None
            name = cols[1]
            sector = cols[2]
            sub_sector = cols[3]
            hq = cols[4]
            founded = int(cols[5]) if cols[5].isdigit() else None
            employees = int(cols[6]) if cols[6].isdigit() else None
            funding = parse_funding(cols[7])
            revenue = parse_funding(cols[8])
            profitable = cols[9] if cols[9] else None
            ai_native = 1 if cols[10] == 'Yes' else 0
            cagr_str = cols[11].replace('%', '').strip()
            cagr = float(cagr_str) if cagr_str else None

            c.execute("""
                INSERT INTO companies (name, sector, sub_sector, location, founded,
                    employees, funding_amount, funding_currency, revenue, profitable,
                    ai_native, cagr_2yr, source, date_added, sifted_rank)
                VALUES (?, ?, ?, ?, ?, ?, ?, '£', ?, ?, ?, ?, 'sifted_100', ?, ?)
            """, (name, sector, sub_sector, hq, founded, employees, funding,
                  revenue, profitable, ai_native, cagr, '2026-03-18', rank))
            count += 1
        elif in_table and not line.startswith('|'):
            break

    conn.commit()
    print(f"Sifted 100: ingested {count} companies")


def ingest_csv(conn):
    """Ingest the LiveLocationData CSV."""
    c = conn.cursor()
    count = 0

    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('Startup', '').strip()
            if not name:
                continue

            currency = row.get('Currency', '£').strip()
            funding_str = row.get('Funding', '').strip()
            try:
                funding = float(funding_str) if funding_str and funding_str.lower() not in ('na', 'n/a', '-', '') else None
            except ValueError:
                funding = None

            # Parse date
            date_raw = row.get('Date', '').strip()
            date_added = date_raw[:10] if date_raw else None

            c.execute("""
                INSERT INTO companies (name, sector, sub_sector, location,
                    funding_amount, funding_currency, funding_round,
                    website, linkedin, twitter,
                    founder_1_name, founder_1_linkedin,
                    founder_2_name, founder_2_linkedin,
                    extra_sectors, source, date_added)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recently_raised', ?)
            """, (
                name,
                row.get('Main Sector', '').strip() or None,
                None,
                row.get('Location', '').strip() or None,
                funding, currency,
                row.get('Round', '').strip() or None,
                row.get('Website', '').strip() or None,
                row.get('LinkedIn', '').strip() or None,
                row.get('Twitter', '').strip() or None,
                row.get('Founder 1 Name', '').strip() or None,
                row.get('Founder 1 LinkedIn', '').strip() or None,
                row.get('Founder 2 Name', '').strip() or None,
                row.get('Founder 2 LinkedIn', '').strip() or None,
                row.get('Extra Sectors', '').strip() or None,
                date_added
            ))
            count += 1

    conn.commit()
    print(f"LiveLocationData: ingested {count} companies")


def print_stats(conn):
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM companies")
    total = c.fetchone()[0]
    c.execute("SELECT source, COUNT(*) FROM companies GROUP BY source")
    by_source = c.fetchall()
    c.execute("SELECT COUNT(DISTINCT name) FROM companies")
    unique = c.fetchone()[0]

    print(f"\n--- Database Stats ---")
    print(f"Total rows: {total}")
    print(f"Unique company names: {unique}")
    for source, count in by_source:
        print(f"  {source}: {count}")

    # Show overlaps
    c.execute("""
        SELECT s.name, s.sector, s.sifted_rank
        FROM companies s
        JOIN companies r ON LOWER(s.name) = LOWER(r.name)
        WHERE s.source = 'sifted_100' AND r.source = 'recently_raised'
        ORDER BY s.sifted_rank
    """)
    overlaps = c.fetchall()
    if overlaps:
        print(f"\nOverlap (in both Sifted 100 AND recently raised): {len(overlaps)}")
        for name, sector, rank in overlaps[:10]:
            print(f"  #{rank} {name} ({sector})")

    # London AI seed/pre-seed in last 30 days
    c.execute("""
        SELECT name, funding_amount, funding_currency, funding_round, date_added
        FROM companies
        WHERE source = 'recently_raised'
          AND location LIKE '%London%'
          AND (sector LIKE '%AI%' OR extra_sectors LIKE '%AI%' OR sector LIKE '%Tech%')
          AND funding_round IN ('Seed', 'Pre-seed', 'Pre-Seed')
          AND date_added >= '2026-02-20'
        ORDER BY date_added DESC
        LIMIT 15
    """)
    recent_ai = c.fetchall()
    if recent_ai:
        print(f"\nRecent London AI seed/pre-seed (last 30 days): {len(recent_ai)}")
        for name, amt, cur, rnd, date in recent_ai:
            amt_str = f"{cur}{amt:,.0f}" if amt else "undisclosed"
            print(f"  {name} — {rnd} {amt_str} ({date})")


if __name__ == "__main__":
    print("Building Boulot companies database...")
    conn = create_db()
    ingest_sifted(conn)
    ingest_csv(conn)
    print_stats(conn)
    conn.close()
    print(f"\nDatabase saved to: {DB_PATH}")
