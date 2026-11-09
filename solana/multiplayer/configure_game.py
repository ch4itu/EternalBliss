"""Create a copy of R10 configured for a verified EternalBliss Devnet program."""
from pathlib import Path
import argparse
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("program_id")
parser.add_argument("game_html", type=Path)
parser.add_argument("output_html", type=Path)
args = parser.parse_args()
if not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}",args.program_id):
    parser.error("Use the public key from the verified Devnet deployment.")
if args.game_html.resolve()==args.output_html.resolve():
    parser.error("Choose a separate output file.")
source=args.game_html.read_text()
for name in ("sharedWorldProgramId","duelProgramId"):
    marker=rf"^const {name} = (?:null|'[1-9A-HJ-NP-Za-km-z]{{32,44}}');$"
    source,count=re.subn(marker,f"const {name} = '{args.program_id}';",source,flags=re.M)
    if count!=1:
        parser.error("The input must be EternalBliss GUI HTML (R10 or later).")
args.output_html.write_text(source)
