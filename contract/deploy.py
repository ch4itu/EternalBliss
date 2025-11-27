#!/usr/bin/env python3
"""
Universal State Machine Deployment Script
==============================================

Cross-platform deployment script for Windows, Linux, and macOS.

Usage:
    python deploy.py

Environment variables:
    NETWORK=testnet or mainnet (default: testnet)
    DEPLOYER_MNEMONIC=your 25-word mnemonic (or will prompt)
    ALGOD_SERVER=custom node URL (optional)

Requirements:
    pip install puyapy py-algorand-sdk
"""

import subprocess
import sys
import os
import json
import time
import getpass
from pathlib import Path
from algosdk import account, mnemonic
from algosdk.v2client import algod
from algosdk.transaction import ApplicationCreateTxn, OnComplete, StateSchema, wait_for_confirmation
import base64

# Contract configuration
CONTRACT_FILE = 'contract.py'  # User can rename this file
CONTRACT_CLASS = 'UniversalStateMachine'
CONTRACT_VERSION = 'v1.0'
CONTRACT_DESCRIPTION = 'Production-ready with finalization & timeout'

def print_header(title):
    """Print formatted header"""
    print("\n" + "="*70)
    print(f"  {title}")
    print("="*70)

def print_step(step, title):
    """Print step header"""
    print(f"\n[{step}] {title}")
    print("-" * 70)

def main():
    print_header(f"Universal State Machine {CONTRACT_VERSION.upper()} Deployment")
    print(f"📝 Contract: {CONTRACT_DESCRIPTION}")
    print(f"💻 Platform: {sys.platform}")

    # Configuration
    network = os.getenv('NETWORK', 'testnet').lower()
    if network == 'testnet':
        algod_server = os.getenv('ALGOD_SERVER', 'https://testnet-api.algonode.cloud')
    else:
        algod_server = os.getenv('ALGOD_SERVER', 'https://mainnet-api.algonode.cloud')

    algod_token = os.getenv('ALGOD_TOKEN', '')

    print(f"🌐 Network: {network.upper()}")
    print(f"🔗 Algod: {algod_server}")

    try:
        # Step 1: Find contract file
        print_step("1/7", "Locate Contract File")

        # Get script directory (works on all platforms)
        script_dir = Path(__file__).parent.resolve()
        contract_path = script_dir / CONTRACT_FILE

        if not contract_path.exists():
            print(f"❌ Contract not found: {contract_path}")
            print(f"💡 Make sure '{CONTRACT_FILE}' is in the same directory as deploy.py")
            print(f"   Expected location: {script_dir}")
            sys.exit(1)

        print(f"✅ Found: {contract_path.name}")
        print(f"   Path: {contract_path}")

        # Step 2: Compile with PuyaPy
        print_step("2/7", "Compile Contract")

        # Output directory (works on all platforms)
        output_dir = script_dir / 'out'
        output_dir.mkdir(exist_ok=True)

        print(f"⏳ Running puyapy...")
        print(f"   Output: {output_dir}")

        # Run puyapy with absolute paths (cross-platform)
        result = subprocess.run(
            ['puyapy', str(contract_path), '--out-dir', str(output_dir)],
            capture_output=True,
            text=True,
            cwd=str(script_dir)  # Set working directory to script location
        )

        if result.returncode != 0:
            print("❌ Compilation failed!")
            print("\n--- STDERR ---")
            print(result.stderr)
            if result.stdout:
                print("\n--- STDOUT ---")
                print(result.stdout)
            sys.exit(1)

        print("✅ Compilation successful")

        # Step 3: Load TEAL files
        print_step("3/7", "Load Compiled TEAL")

        # Look for TEAL files (cross-platform path handling)
        approval_path = output_dir / f"{CONTRACT_CLASS}.approval.teal"
        clear_path = output_dir / f"{CONTRACT_CLASS}.clear.teal"

        # If exact match not found, try glob pattern
        if not approval_path.exists():
            teal_files = list(output_dir.glob('*.approval.teal'))
            if teal_files:
                approval_path = teal_files[0]
            else:
                print(f"❌ Approval TEAL not found in {output_dir}")
                print("Available files:")
                for f in output_dir.glob('*'):
                    print(f"  - {f.name}")
                sys.exit(1)

        if not clear_path.exists():
            clear_files = list(output_dir.glob('*.clear.teal'))
            if clear_files:
                clear_path = clear_files[0]
            else:
                print(f"❌ Clear TEAL not found in {output_dir}")
                sys.exit(1)

        # Read TEAL files (binary mode for cross-platform compatibility)
        with open(approval_path, 'r', encoding='utf-8') as f:
            approval_teal = f.read()

        with open(clear_path, 'r', encoding='utf-8') as f:
            clear_teal = f.read()

        print(f"✅ Loaded: {approval_path.name}")
        print(f"✅ Loaded: {clear_path.name}")

        # Step 4: Compile to bytecode
        print_step("4/7", "Compile TEAL to Bytecode")

        algod_client = algod.AlgodClient(algod_token, algod_server)

        print("⏳ Compiling approval program...")
        approval_result = algod_client.compile(approval_teal)
        approval_program = base64.b64decode(approval_result['result'])

        print("⏳ Compiling clear program...")
        clear_result = algod_client.compile(clear_teal)
        clear_program = base64.b64decode(clear_result['result'])

        approval_size = len(approval_program)
        clear_size = len(clear_program)

        print(f"✅ Approval: {approval_size:,} bytes")
        print(f"✅ Clear: {clear_size:,} bytes")

        # Calculate extra pages
        base_size = 2048
        page_size = 2048

        if approval_size <= base_size:
            extra_pages = 0
        else:
            bytes_over = approval_size - base_size
            extra_pages = (bytes_over + page_size - 1) // page_size

        if extra_pages > 0:
            print(f"📄 Extra pages needed: {extra_pages}")

        # Step 5: Get deployer account
        print_step("5/7", "Account Setup")

        mnemonic_phrase = os.getenv('DEPLOYER_MNEMONIC')
        if not mnemonic_phrase:
            print("💡 No DEPLOYER_MNEMONIC environment variable found")
            mnemonic_phrase = getpass.getpass("Enter your 25-word mnemonic (hidden): ")

        try:
            private_key = mnemonic.to_private_key(mnemonic_phrase.strip())
            sender = account.address_from_private_key(private_key)
        except Exception as e:
            print(f"❌ Invalid mnemonic: {e}")
            sys.exit(1)

        print(f"✅ Deployer: {sender}")

        # Step 6: Check balance
        print_step("6/7", "Balance Check")

        account_info = algod_client.account_info(sender)
        balance = account_info['amount'] / 1_000_000
        min_balance = account_info['min-balance'] / 1_000_000
        available = balance - min_balance

        print(f"💰 Balance: {balance:.6f} ALGO")
        print(f"🔒 Min Balance: {min_balance:.6f} ALGO")
        print(f"💵 Available: {available:.6f} ALGO")

        # Estimate cost
        base_cost = 0.1
        page_cost = 0.1 * extra_pages
        total_cost = base_cost + page_cost

        print(f"\n📊 Estimated cost: ~{total_cost:.4f} ALGO")

        if available < total_cost:
            print(f"\n❌ Insufficient balance!")
            print(f"   Need: {total_cost:.4f} ALGO")
            print(f"   Have: {available:.6f} ALGO")

            if network == 'testnet':
                print(f"\n💡 Get testnet ALGO: https://bank.testnet.algorand.network/")
                print(f"   Send to: {sender}")

            sys.exit(1)

        # Step 7: Deploy
        print_step("7/7", "Deploy to Blockchain")

        print(f"⏳ Creating application transaction...")

        params = algod_client.suggested_params()

        # Global state schema
        global_schema = StateSchema(num_uints=0, num_byte_slices=1)
        local_schema = StateSchema(num_uints=0, num_byte_slices=0)

        txn = ApplicationCreateTxn(
            sender=sender,
            sp=params,
            on_complete=OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=global_schema,
            local_schema=local_schema,
            extra_pages=extra_pages
        )

        signed_txn = txn.sign(private_key)
        txid = algod_client.send_transaction(signed_txn)

        print(f"📤 Transaction sent: {txid}")
        print(f"⏳ Waiting for confirmation...")

        result = wait_for_confirmation(algod_client, txid, 5)
        app_id = result['application-index']

        # Success!
        print_header("✅ DEPLOYMENT SUCCESSFUL!")
        print(f"📱 Application ID: {app_id}")
        print(f"🔗 Transaction: {txid}")
        print(f"🌐 Network: {network.upper()}")
        print(f"📏 Contract Size: {approval_size:,} bytes")

        # Save deployment info
        deploy_info = {
            'version': CONTRACT_VERSION,
            'app_id': app_id,
            'txid': txid,
            'network': network,
            'deployer': sender,
            'approval_size': approval_size,
            'clear_size': clear_size,
            'extra_pages': extra_pages,
            'timestamp': int(time.time()),
            'description': CONTRACT_DESCRIPTION,
            'platform': sys.platform
        }

        # Save to script directory (cross-platform)
        info_file = script_dir / f'deployment_{network}.json'
        with open(info_file, 'w', encoding='utf-8') as f:
            json.dump(deploy_info, f, indent=2)

        print(f"\n💾 Info saved: {info_file.name}")
        print(f"   Location: {info_file}")

        # Explorer link
        if network == 'testnet':
            explorer = f"https://testnet.explorer.perawallet.app/application/{app_id}"
        else:
            explorer = f"https://explorer.perawallet.app/application/{app_id}"

        print(f"\n🔍 View on explorer:")
        print(f"   {explorer}")

        # Next steps
        print(f"\n📋 NEXT STEPS:")
        print(f"   1. Test contract operations on {network}")
        print(f"   2. Update auto-code-review.html:")
        print(f"      const APP_ID = {app_id};")
        print(f"   3. Add timeout parameter to createProcess():")
        print(f"      const TIMEOUT_ROUNDS = 1000;  // ~1 hour")
        print(f"      await window.createProcess(id, addr, state, TIMEOUT_ROUNDS);")

        print(f"\n✅ Deployment complete!")

    except KeyboardInterrupt:
        print("\n\n❌ Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
