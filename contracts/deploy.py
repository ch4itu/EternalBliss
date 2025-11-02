#!/usr/bin/env python3

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

class Config:
    """Deployment configuration"""
    def __init__(self):
        self.algod_server = os.getenv('ALGOD_SERVER', 'https://testnet-api.algonode.cloud')
        self.algod_token = os.getenv('ALGOD_TOKEN', '')
        self.network = os.getenv('NETWORK', 'testnet')
        
    def validate(self):
        """Validate configuration"""
        if self.network not in ['testnet', 'mainnet']:
            raise ValueError(f"Invalid network: {self.network}")
        print(f"✅ Network: {self.network.upper()}")
        print(f"✅ Algod Server: {self.algod_server}")

config = Config()

def print_section(title: str, emoji: str = "📌"):
    """Print formatted section header"""
    print("\n" + "="*60)
    print(f"{emoji} {title}")
    print("="*60)

def retry_with_backoff(func, max_attempts=3, initial_delay=1):
    """Retry a function with exponential backoff"""
    for attempt in range(max_attempts):
        try:
            return func()
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            delay = initial_delay * (2 ** attempt)
            print(f"⚠️  Attempt {attempt + 1} failed: {e}")
            print(f"⏳ Retrying in {delay} seconds...")
            time.sleep(delay)

def main():
    try:
        config.validate()
        
        # Check if contract file exists
        contract_file = Path('contract.py')
        if not contract_file.exists():
            print(f"❌ Contract file not found: {contract_file.absolute()}")
            print(f"\n💡 Make sure 'contract.py' is in the same directory as this script.")
            print(f"   Current directory: {Path.cwd()}")
            sys.exit(1)
        
        print(f"✅ Found contract: {contract_file.absolute()}")
        
        print_section("Step 1: Compile Contract with PuyaPy", "🔨")
        
        # Create output directory if it doesn't exist
        output_dir = Path('out')
        output_dir.mkdir(exist_ok=True)
        print(f"✅ Output directory: {output_dir.absolute()}")
        
        # Compile contract with output directory
        print("⏳ Compiling contract...")
        result = subprocess.run(
            ['puyapy', 'contract.py', '--out-dir', 'out'],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print("❌ Compilation failed!")
            print("\n--- STDOUT ---")
            print(result.stdout)
            print("\n--- STDERR ---")
            print(result.stderr)
            sys.exit(1)
        
        print("✅ Contract compiled successfully!")
        print(f"   {result.stdout.strip() if result.stdout else 'Compilation complete'}")
        
        # Read compiled programs
        print_section("Step 2: Load Compiled Programs", "📂")
        
        approval_teal_path = Path('out/UniversalStateMachineUltimate.approval.teal')
        clear_teal_path = Path('out/UniversalStateMachineUltimate.clear.teal')
        
        if not approval_teal_path.exists():
            print(f"❌ Approval TEAL not found: {approval_teal_path}")
            print(f"\n💡 Check the 'out' directory for available files:")
            out_files = list(Path('out').glob('*.teal'))
            for f in out_files:
                print(f"   - {f}")
            sys.exit(1)
        
        if not clear_teal_path.exists():
            print(f"❌ Clear TEAL not found: {clear_teal_path}")
            sys.exit(1)
        
        with open(approval_teal_path, 'r') as f:
            approval_teal = f.read()
            
        with open(clear_teal_path, 'r') as f:
            clear_teal = f.read()
        
        print(f"✅ Loaded approval TEAL: {approval_teal_path}")
        print(f"✅ Loaded clear TEAL: {clear_teal_path}")
        
        # Compile TEAL to bytecode
        print_section("Step 3: Compile TEAL to Bytecode", "⚙️")
        
        algod_client = algod.AlgodClient(config.algod_token, config.algod_server)
        
        approval_result = algod_client.compile(approval_teal)
        approval_program = base64.b64decode(approval_result['result'])
        approval_size = len(approval_program)
        
        clear_result = algod_client.compile(clear_teal)
        clear_program = base64.b64decode(clear_result['result'])
        clear_size = len(clear_program)
        
        print(f"✅ Approval program: {approval_size} bytes")
        print(f"✅ Clear program: {clear_size} bytes")
        
        # Calculate required extra pages
        print_section("Step 4: Calculate Program Pages", "📊")
        
        base_size = 2048
        page_size = 2048
        max_pages = 3
        
        if approval_size <= base_size:
            extra_pages = 0
            print(f"✅ No extra pages needed ({approval_size} <= {base_size} bytes)")
        else:
            bytes_over = approval_size - base_size
            extra_pages = (bytes_over + page_size - 1) // page_size
            
            if extra_pages > max_pages:
                print(f"❌ Contract too large!")
                print(f"   Size: {approval_size} bytes")
                print(f"   Max: {base_size + (max_pages * page_size)} bytes")
                print(f"   Over by: {approval_size - (base_size + max_pages * page_size)} bytes")
                sys.exit(1)
            
            print(f"✅ Extra pages required: {extra_pages}")
            print(f"   Base: {base_size} bytes")
            print(f"   Extra: {extra_pages} × {page_size} = {extra_pages * page_size} bytes")
            print(f"   Total capacity: {base_size + (extra_pages * page_size)} bytes")
            print(f"   Used: {approval_size} bytes")
            print(f"   Remaining: {base_size + (extra_pages * page_size) - approval_size} bytes")
        
        print_section("Step 5: Account Setup", "🔑")
        
        mnemonic_phrase = os.getenv('DEPLOYER_MNEMONIC')
        
        if not mnemonic_phrase:
            print("No DEPLOYER_MNEMONIC environment variable found")
            mnemonic_phrase = getpass.getpass("Enter deployer mnemonic (hidden): ")
        
        try:
            private_key = mnemonic.to_private_key(mnemonic_phrase)
            sender = account.address_from_private_key(private_key)
        except Exception as e:
            print(f"❌ Invalid mnemonic: {e}")
            sys.exit(1)
        
        print(f"✅ Deployer address: {sender}")
        
        print_section("Step 6: Balance Check", "💰")
        
        account_info = algod_client.account_info(sender)
        balance = account_info.get('amount', 0) / 1_000_000
        min_balance = account_info.get('min-balance', 0) / 1_000_000
        
        print(f"💰 Balance: {balance:.6f} ALGO")
        print(f"🔒 Min Balance: {min_balance:.6f} ALGO")
        print(f"💵 Available: {balance - min_balance:.6f} ALGO")
        
        base_cost = 0.1  # Base app creation
        page_cost = 0.1 * extra_pages  # Extra pages
        total_cost = base_cost + page_cost
        
        print(f"\n📊 Estimated deployment cost:")
        print(f"   Base: {base_cost:.4f} ALGO")
        if extra_pages > 0:
            print(f"   Extra pages ({extra_pages}): {page_cost:.4f} ALGO")
        print(f"   Total: ~{total_cost:.4f} ALGO")
        
        if balance - min_balance < total_cost:
            print(f"\n❌ Insufficient balance!")
            print(f"   Need: {total_cost:.4f} ALGO")
            print(f"   Have: {balance - min_balance:.6f} ALGO")
            print(f"\n💡 Get testnet ALGO: https://bank.testnet.algorand.network/")
            sys.exit(1)
        
        # Deploy
        print_section("Step 7: Blockchain Deployment", "🚀")
        
        def deploy_transaction():
            params = algod_client.suggested_params()
            
            # CRITICAL: Include extra_pages parameter!
            txn = ApplicationCreateTxn(
                sender=sender,
                sp=params,
                on_complete=OnComplete.NoOpOC,
                approval_program=approval_program,
                clear_program=clear_program,
                global_schema=StateSchema(num_uints=4, num_byte_slices=1),  # FIXED: 4 uints
                local_schema=StateSchema(num_uints=0, num_byte_slices=0),
                extra_pages=extra_pages  # ← CRITICAL: This was missing!
            )
            
            signed_txn = txn.sign(private_key)
            txid = algod_client.send_transaction(signed_txn)
            print(f"📤 Transaction sent: {txid}")
            return txid
        
        print("⏳ Deploying to blockchain...")
        txid = retry_with_backoff(deploy_transaction, max_attempts=3)
        
        print("⏳ Waiting for confirmation...")
        result = wait_for_confirmation(algod_client, txid, 4)
        
        app_id = result['application-index']
        
        print_section("✅ DEPLOYMENT SUCCESSFUL!", "🎉")
        print(f"📱 Application ID: {app_id}")
        print(f"🔗 Transaction: {txid}")
        print(f"📊 Program size: {approval_size} bytes")
        print(f"📄 Extra pages: {extra_pages}")
        
        deployment_info = {
            'app_id': app_id,
            'txid': txid,
            'network': config.network,
            'deployer': sender,
            'approval_size': approval_size,
            'clear_size': clear_size,
            'extra_pages': extra_pages,
            'timestamp': time.time()
        }
        
        with open('deployment_info.json', 'w') as f:
            json.dump(deployment_info, f, indent=2)
        
        print(f"\n💾 Deployment info saved to: deployment_info.json")
        
        if config.network == 'testnet':
            print(f"\n🔍 View on TestNet Explorer:")
            print(f"   https://testnet.explorer.perawallet.app/application/{app_id}")
        else:
            print(f"\n🔍 View on MainNet Explorer:")
            print(f"   https://explorer.perawallet.app/application/{app_id}")
        
        return app_id
        
    except KeyboardInterrupt:
        print("\n\n❌ Deployment cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Deployment failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
