"""Generate the SIMULATED Aureon Electronics demo dataset (deterministic).

Every company, supplier, figure and event here is fictional. Dates are stored as day offsets from the
seeding date so the demo stays current. Usage:  python scripts/generate_sample_data.py
"""
from __future__ import annotations

import csv
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "sample_data" / "aureon"
rng = random.Random(20261121)

LOCATIONS = [
    ("Aureon HQ – Pune", "headquarters", "Pune", "India", 18.52, 73.86, ""),
    ("Plant 1 – Chakan (Pune)", "manufacturing", "Pune", "India", 18.76, 73.86, 40000),
    ("Plant 2 – Sriperumbudur", "manufacturing", "Chennai", "India", 12.97, 79.95, 55000),
    ("Plant 3 – Noida", "manufacturing", "Noida", "India", 28.54, 77.39, 30000),
    ("WH – Bhiwandi", "warehouse", "Mumbai", "India", 19.30, 73.06, 120000),
    ("WH – Hoskote", "warehouse", "Bengaluru", "India", 13.07, 77.80, 80000),
    ("WH – Dankuni", "warehouse", "Kolkata", "India", 22.68, 88.29, 50000),
    ("DC – Gurugram", "distribution", "Gurugram", "India", 28.46, 77.03, 60000),
]

# code, name, category, country, city, on-time rate, quality, lead time (days), annual spend INR
SUPPLIERS = [
    ("SUP-001", "NovaChip Semiconductor Ltd (fictional)", "Microcontrollers", "Taiwan", "Hsinchu", 0.93, 94, 42, 312_000_000),
    ("SUP-002", "Lumen Micro Devices Co. (fictional)", "Microcontrollers", "China", "Shenzhen", 0.88, 86, 35, 148_000_000),
    ("SUP-003", "Penang MicroWorks Sdn Bhd (fictional)", "Microcontrollers", "Malaysia", "Penang", 0.91, 90, 38, 64_000_000),
    ("SUP-004", "Busan CellEnergy Co. (fictional)", "Li-ion cells", "South Korea", "Busan", 0.95, 96, 30, 275_000_000),
    ("SUP-005", "Ganga Cells Pvt Ltd (fictional)", "Li-ion cells", "India", "Noida", 0.79, 78, 14, 41_000_000),
    ("SUP-006", "Kansai Precision Glass KK (fictional)", "Display panels", "Japan", "Osaka", 0.97, 98, 45, 188_000_000),
    ("SUP-007", "Hanoi FlexCircuit JSC (fictional)", "PCBs", "Vietnam", "Hanoi", 0.84, 83, 28, 96_000_000),
    ("SUP-008", "Deccan Polymers Pvt Ltd (fictional)", "ABS resin & enclosures", "India", "Pune", 0.90, 88, 7, 52_000_000),
    ("SUP-009", "Coromandel CopperTech (fictional)", "Copper wire", "India", "Chennai", 0.92, 91, 10, 37_000_000),
    ("SUP-010", "Jalisco Passive Components SA (fictional)", "Capacitors & resistors", "Mexico", "Guadalajara", 0.81, 85, 40, 29_000_000),
    ("SUP-011", "Rheinland SensorLab GmbH (fictional)", "Sensors", "Germany", "Dresden", 0.94, 95, 50, 71_000_000),
]

# sku, name, kind, category, unit, unit cost, unit price, primary supplier
PRODUCTS = [
    ("RM-MCU-32", "32-bit MCU (ARM Cortex-M4)", "component", "Semiconductors", "unit", 310, "", "SUP-001"),
    ("RM-CELL-21", "21700 Li-ion cell 5000mAh", "component", "Batteries", "unit", 285, "", "SUP-004"),
    ("RM-DISP-35", "3.5\" TFT display panel", "component", "Displays", "unit", 920, "", "SUP-006"),
    ("RM-PCB-4L", "4-layer PCB (bare board)", "component", "PCBs", "unit", 140, "", "SUP-007"),
    ("RM-ABS-01", "ABS resin pellets", "raw_material", "Polymers", "kg", 165, "", "SUP-008"),
    ("RM-CU-18", "Copper wire 18 AWG", "raw_material", "Metals", "kg", 890, "", "SUP-009"),
    ("RM-CAP-MX", "MLCC capacitor reel (10k)", "component", "Passives", "reel", 2400, "", "SUP-010"),
    ("RM-SNS-TH", "Temperature/humidity sensor", "component", "Sensors", "unit", 175, "", "SUP-011"),
    ("FG-SM200", "Aureon Smart Meter SM-200", "finished_good", "Energy devices", "unit", 2350, 3999, ""),
    ("FG-PB20K", "Aureon Power Bank PB-20K", "finished_good", "Portable power", "unit", 1180, 2199, ""),
    ("FG-EB5", "Aureon Wireless Earbuds EB-5", "finished_good", "Audio", "unit", 860, 1799, ""),
    ("FG-TH3", "Aureon Smart Thermostat TH-3", "finished_good", "Smart home", "unit", 2900, 5499, ""),
    ("FG-EC7", "Aureon EV Charger Controller EC-7", "finished_good", "EV infrastructure", "unit", 6400, 11999, ""),
]

COMPONENT_HOME = {"component": [1, 2, 3], "raw_material": [1, 2, 3], "finished_good": [4, 5, 6, 7]}


def inventory_rows():
    rows = []
    for sku, _, kind, *_rest in PRODUCTS:
        lead = next((s[7] for s in SUPPLIERS if s[0] == _rest[-1]), 10) if kind != "finished_good" else 5
        for li in COMPONENT_HOME[kind]:
            demand = round(rng.uniform(40, 400) if kind != "finished_good" else rng.uniform(15, 120), 1)
            ss = round(demand * max(lead, 5) * 0.3)
            rop = round(demand * lead + ss)
            band = rng.random()
            if sku == "RM-MCU-32":            # the scenario's exposed component: thin cover
                qty = round(demand * rng.uniform(8, 16))
            elif band < 0.15:
                qty = round(ss * rng.uniform(0.3, 0.9))
            elif band < 0.35:
                qty = round(rop * rng.uniform(0.7, 0.98))
            elif band < 0.9:
                qty = round(rop * rng.uniform(1.1, 2.5))
            else:
                qty = round(demand * rng.uniform(150, 260))
            rows.append({"sku": sku, "location": LOCATIONS[li][0], "quantity_on_hand": qty, "reorder_point": rop,
                         "safety_stock": ss, "avg_daily_demand": demand, "lead_time_days": lead,
                         "last_movement_offset_days": -rng.randint(0, 40 if band < 0.9 else 160)})
    return rows


SHIPMENTS = [
    # ref, dir, supplier, sku, qty, origin, country, destination, mode, carrier, status, depart_off, orig_eta_off, cur_eta_off
    ("SHP-24101", "inbound", "SUP-001", "RM-MCU-32", 60000, "Kaohsiung Port", "Taiwan", "Plant 2 – Sriperumbudur", "sea", "BlueWake Lines (fictional)", "delayed", -18, 4, 13),
    ("SHP-24102", "inbound", "SUP-001", "RM-MCU-32", 25000, "Taoyuan Airport", "Taiwan", "Plant 1 – Chakan (Pune)", "air", "SkyFreight Cargo (fictional)", "in_transit", -2, 2, 2),
    ("SHP-24103", "inbound", "SUP-004", "RM-CELL-21", 120000, "Busan Port", "South Korea", "Plant 2 – Sriperumbudur", "sea", "BlueWake Lines (fictional)", "in_transit", -9, 8, 8),
    ("SHP-24104", "inbound", "SUP-006", "RM-DISP-35", 18000, "Osaka Port", "Japan", "Plant 1 – Chakan (Pune)", "sea", "Meridian Ocean (fictional)", "in_transit", -12, 9, 10),
    ("SHP-24105", "inbound", "SUP-007", "RM-PCB-4L", 90000, "Hai Phong Port", "Vietnam", "Plant 3 – Noida", "sea", "Meridian Ocean (fictional)", "delayed", -20, 1, 7),
    ("SHP-24106", "inbound", "SUP-002", "RM-MCU-32", 30000, "Yantian Port", "China", "Plant 2 – Sriperumbudur", "sea", "BlueWake Lines (fictional)", "planned", 3, 22, 22),
    ("SHP-24107", "inbound", "SUP-010", "RM-CAP-MX", 400, "Manzanillo Port", "Mexico", "Plant 1 – Chakan (Pune)", "sea", "Atlas Maritime (fictional)", "in_transit", -25, 12, 15),
    ("SHP-24108", "inbound", "SUP-011", "RM-SNS-TH", 40000, "Hamburg Port", "Germany", "Plant 3 – Noida", "sea", "Atlas Maritime (fictional)", "in_transit", -16, 11, 11),
    ("SHP-24109", "inbound", "SUP-008", "RM-ABS-01", 22000, "Pune", "India", "Plant 1 – Chakan (Pune)", "road", "Sahyadri Roadways (fictional)", "delivered", -6, -4, -4),
    ("SHP-24110", "inbound", "SUP-009", "RM-CU-18", 9000, "Chennai", "India", "Plant 2 – Sriperumbudur", "road", "Coastal Haulage (fictional)", "in_transit", -1, 1, 1),
    ("SHP-24111", "inbound", "SUP-005", "RM-CELL-21", 30000, "Noida", "India", "Plant 3 – Noida", "road", "NCR Express (fictional)", "delayed", -5, -1, 3),
    ("SHP-24112", "inbound", "SUP-003", "RM-MCU-32", 15000, "Penang Port", "Malaysia", "Plant 2 – Sriperumbudur", "sea", "Meridian Ocean (fictional)", "delivered", -30, -9, -8),
    ("SHP-24201", "outbound", "", "FG-SM200", 6000, "WH – Bhiwandi", "India", "Retail chain DC, Mumbai (fictional)", "road", "Sahyadri Roadways (fictional)", "in_transit", -1, 1, 1),
    ("SHP-24202", "outbound", "", "FG-PB20K", 14000, "WH – Hoskote", "India", "E-commerce FC, Bengaluru (fictional)", "road", "Deccan Freight (fictional)", "delivered", -4, -3, -3),
    ("SHP-24203", "outbound", "", "FG-EC7", 800, "DC – Gurugram", "India", "Dubai distributor (fictional)", "air", "SkyFreight Cargo (fictional)", "planned", 2, 4, 4),
    ("SHP-24204", "outbound", "", "FG-TH3", 2500, "WH – Dankuni", "India", "Dhaka distributor (fictional)", "road", "Eastern Corridor Logistics (fictional)", "delayed", -6, -1, 2),
    ("SHP-24205", "outbound", "", "FG-EB5", 20000, "WH – Bhiwandi", "India", "Marketplace FC, Delhi (fictional)", "rail", "Konkan Rail Freight (fictional)", "in_transit", -2, 2, 3),
    ("SHP-24206", "outbound", "", "FG-SM200", 3500, "DC – Gurugram", "India", "State discom stores, Jaipur (fictional)", "road", "NCR Express (fictional)", "cancelled", -10, -7, -7),
]

DISRUPTIONS = [
    # title, category, severity, status, countries, suppliers, summary, detected_off, resolved_off
    ("Fire halts a fab line at NovaChip Semiconductor", "supplier_incident", 78, "active", "Taiwan", "SUP-001",
     "SIMULATED: A fire at the supplier's Hsinchu facility has stopped one of two production lines. Supplier estimates "
     "4–6 weeks to restore output. NovaChip supplies ~65% of Aureon's MCU volume.", -1, ""),
    ("Congestion at South China container ports", "port_congestion", 55, "monitoring", "China", "SUP-002",
     "SIMULATED: Vessel waiting times at Yantian have risen to 3–4 days after a weather closure.", -6, ""),
    ("Cyclone closes Chennai port for 3 days", "natural_disaster", 62, "resolved", "India", "SUP-009",
     "SIMULATED historical event: inbound copper and cell deliveries slipped by 4–6 days.", -210, -203),
    ("Hanoi FlexCircuit repeated late deliveries", "supplier_performance", 40, "resolved", "Vietnam", "SUP-007",
     "SIMULATED historical record: three consecutive PCB lots arrived 5+ days late during Q2.", -150, -95),
]

FEEDBACK = [
    ("FG-PB20K", 9, "Charges my phone three times, solid build."),
    ("FG-PB20K", 4, "Stopped holding charge after two months."),
    ("FG-EB5", 8, "Great sound for the price."),
    ("FG-EB5", 3, "Left earbud disconnects constantly."),
    ("FG-SM200", 10, "Installer said it was the easiest meter to commission."),
    ("FG-TH3", 6, "Works but app setup was confusing."),
    ("FG-TH3", 2, "Delivered two weeks late and box was damaged."),
    ("FG-EC7", 9, "Reliable controller, firmware updates are good."),
]


def write(name, header, rows):
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write("locations.csv", ["name", "kind", "city", "country", "latitude", "longitude", "capacity_units"], LOCATIONS)
    write("suppliers.csv", ["code", "name", "category", "country", "city", "on_time_delivery_rate", "quality_score",
                            "avg_lead_time_days", "annual_spend"], SUPPLIERS)
    write("products.csv", ["sku", "name", "kind", "category", "unit", "unit_cost", "unit_price", "primary_supplier_code"], PRODUCTS)
    inv = inventory_rows()
    write("inventory.csv", list(inv[0].keys()), [list(r.values()) for r in inv])
    unit_cost = {p[0]: p[5] for p in PRODUCTS}
    write("shipments.csv", ["reference", "direction", "supplier_code", "sku", "quantity", "value", "origin", "origin_country",
                            "destination", "mode", "carrier", "status", "departed_offset_days", "original_eta_offset_days",
                            "current_eta_offset_days"],
          [(r[0], r[1], r[2], r[3], r[4], r[4] * unit_cost[r[3]], *r[5:]) for r in SHIPMENTS])
    write("disruptions.csv", ["title", "category", "severity", "status", "affected_countries", "affected_supplier_codes",
                              "summary", "detected_offset_days", "resolved_offset_days"], DISRUPTIONS)
    write("customer_feedback.csv", ["sku", "nps_score_0_10", "comment"], FEEDBACK)
    (OUT / "README.md").write_text(
        "# Aureon Electronics Pvt. Ltd. — SIMULATED demo dataset\n\n"
        "Everything in this folder is fictional and generated by `scripts/generate_sample_data.py`.\n"
        "Supplier and carrier names are invented. Dates are offsets in days from the seeding date.\n"
        "The files double as templates for the CSV upload formats introduced in Phase 3.\n", encoding="utf-8")
    print(f"wrote {len(list(OUT.glob('*.csv')))} CSV files to {OUT}")


if __name__ == "__main__":
    main()
