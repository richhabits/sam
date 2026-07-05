---
name: "Finance Playbook"
brief: "Tracks runway, categorizes expenses from bank exports, and flags anomalies."
author: "HECTIC"
version: "1.0"
---

# Finance Playbook

This skill allows SAM to act as your fractional CFO and bookkeeper. When the user asks you to "run the finances" or "check the bank export", you will strictly follow this playbook.

## Goal
Process bank statement CSVs, categorize expenses, calculate runway, and flag any unusual spending.

## Step 1: Ingest Data
1. Find the recent bank CSV export (usually in `~/Downloads` or iCloud Drop).
2. Read the file contents.

## Step 2: Categorize & Calculate
1. Group transactions into these strict categories:
   - **SaaS & Software**
   - **Payroll & Contractors**
   - **Marketing & Ads**
   - **Travel & Meals**
   - **Misc**
2. Sum the total expenses for the month.
3. Calculate the current cash balance (from the latest row or user prompt).
4. Divide cash balance by total monthly expenses to calculate **Months of Runway**.

## Step 3: Anomaly Detection
1. Flag any single transaction over £1,000.
2. Flag any duplicate transactions on the same day.
3. Flag any new recurring SaaS subscriptions that weren't present last month.

## Step 4: Report
Generate a clean, professional summary. If there are anomalies, highlight them with ⚠️.
Always end the report by asking if you should log this summary to Notion using the `notion_append_block` tool.
