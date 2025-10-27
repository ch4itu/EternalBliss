#!/usr/bin/env python3
"""
Windows-compatible deployment script for UniversalStateMachine Contract
This hybrid contract supports BOTH gaming and generic terminology
Perfect for backward compatibility + future flexibility
"""
import subprocess
import sys
import os
from algosdk import account, mnemonic
from algosdk.v2client import algod
from algosdk.transaction import ApplicationCreateTxn, OnComplete, StateSchema, wait_for_confirmation
import base64

# Configuration
ALGOD_SERVER = "https://testnet-api.algonode.cloud"
ALGOD_TOKEN = ""

print("="*60)
print("🚀 DEPLOYING UNIVERSAL STATE MACHINE CONTRACT")
print("="*60)
print("\n🎯 HYBRID CONTRACT - Best of both worlds!")
print("  ✅ Gaming methods (save_player, start_battle)")
print("  ✅ Generic methods (save_entity, start_process)")
print("  ✅ Full backward compatibility")
print("  ✅ ANY user can create content")
print("="*60)

# Step 1: Compile with PuyaPy
print("\n📦 Step 1: Compiling contract with PuyaPy...")
print("-" * 60)

# Use system python with puyapy
result = subprocess.run(
    ["python", "-m", "puyapy", "contract.py", "--out-dir", "artifacts"],
    capture_output=True,
    text=True
)

print(result.stdout)
if result.stderr:
    print(result.stderr)

if result.returncode != 0:
    print("❌ Compilation failed!")
    print("\n💡 Make sure you have puyapy installed:")
    print("   pip install puyapy")
    sys.exit(1)

print("✅ Compilation successful!")

# Check if TEAL files exist
approval_path = "artifacts/UniversalStateMachine.approval.teal"
clear_path = "artifacts/UniversalStateMachine.clear.teal"

if not os.path.exists(approval_path):
    print(f"❌ Error: {approval_path} not found!")
    sys.exit(1)

if not os.path.exists(clear_path):
    print(f"❌ Error: {clear_path} not found!")
    sys.exit(1)

# Step 2: Get mnemonic
print("\n🔑 Step 2: Enter your mnemonic")
print("-" * 60)
print("Paste your 25-word TestNet mnemonic:")
MNEMONIC = input().strip()

words = MNEMONIC.split()
if len(words) != 25:
    print(f"❌ Error: Expected 25 words, got {len(words)}")
    sys.exit(1)

# Step 3: Initialize account
print("\n💼 Step 3: Initializing account...")
print("-" * 60)

algod_client = algod.AlgodClient(ALGOD_TOKEN, ALGOD_SERVER)

private_key = mnemonic.to_private_key(MNEMONIC)
sender = account.address_from_private_key(private_key)

print(f"📍 Deploying from: {sender}")

# Check balance
account_info = algod_client.account_info(sender)
balance = account_info['amount'] / 1_000_000
print(f"💰 Balance: {balance:.4f} ALGO")

if balance < 0.2:
    print("\n⚠️  WARNING: Low balance!")
    print("Get TestNet ALGO from: https://bank.testnet.algorand.network/")
    sys.exit(1)

# Step 4: Read and compile TEAL
print("\n📄 Step 4: Reading compiled TEAL files...")
print("-" * 60)

with open(approval_path, 'r') as f:
    approval_teal = f.read()
with open(clear_path, 'r') as f:
    clear_teal = f.read()

print("✅ TEAL files loaded")

print("\n🔨 Step 5: Compiling TEAL to bytecode...")
print("-" * 60)

approval_result = algod_client.compile(approval_teal)
approval_program = base64.b64decode(approval_result['result'])
print(f"✅ Approval program: {len(approval_program)} bytes")

clear_result = algod_client.compile(clear_teal)
clear_program = base64.b64decode(clear_result['result'])
print(f"✅ Clear program: {len(clear_program)} bytes")

# Step 5: Deploy
print("\n🚀 Step 6: Deploying to TestNet...")
print("-" * 60)

params = algod_client.suggested_params()

# Global schema: 4 uints (total_players, total_entities, total_battles, total_processes), 1 bytes (admin)
txn = ApplicationCreateTxn(
    sender=sender,
    sp=params,
    on_complete=OnComplete.NoOpOC,
    approval_program=approval_program,
    clear_program=clear_program,
    global_schema=StateSchema(num_uints=4, num_byte_slices=1),  # Note: 4 uints for hybrid
    local_schema=StateSchema(num_uints=0, num_byte_slices=0)
)

signed_txn = txn.sign(private_key)
txid = algod_client.send_transaction(signed_txn)

print(f"📤 Transaction sent: {txid}")
print("⏳ Waiting for confirmation...")

result = wait_for_confirmation(algod_client, txid, 4)

app_id = result['application-index']

print("\n" + "="*60)
print("🎉 DEPLOYMENT SUCCESSFUL!")
print("="*60)
print(f"\n📱 APP_ID: {app_id}")
print(f"🔗 Transaction: {txid}")
print(f"\n🌐 View on AlgoExplorer:")
print(f"   https://testnet.algoexplorer.io/application/{app_id}")
print("\n" + "="*60)

# Verify global state
print("\n✅ Verifying deployment...")
print("-" * 60)

app_info = algod_client.application_info(app_id)
if 'params' in app_info and 'global-state' in app_info['params']:
    print("Global State:")
    for item in app_info['params']['global-state']:
        key = base64.b64decode(item['key']).decode('utf-8', errors='ignore')
        if item['value']['type'] == 1:  # bytes
            value = "admin address"
        else:  # uint
            value = item['value'].get('uint', 0)
        print(f"  {key}: {value}")

print("\n" + "="*60)
print("🎮 GAMING METHODS (Backward Compatible):")
print("  - save_player(player_id, state_data)")
print("  - load_player(player_id)")
print("  - get_player_owner(player_id)")
print("  - start_battle(battle_id, opponent, deadline, state)")
print("  - update_battle(battle_id, new_state)")
print("  - load_battle(battle_id)")
print("  - get_stats() → (total_players, total_battles)")

print("\n📦 GENERIC METHODS (New Interface):")
print("  - save_entity(entity_id, state_data)")
print("  - load_entity(entity_id)")
print("  - get_entity_owner(entity_id)")
print("  - start_process(process_id, participant, deadline, state)")
print("  - update_process(process_id, new_state)")
print("  - load_process(process_id)")
print("  - get_state_counts() → (total_entities, total_processes)")

print("\n🔄 UNIFIED METHOD:")
print("  - get_universal_stats() → (players, entities, battles, processes)")
print("="*60)

# Method selectors for reference
print("\n📋 METHOD SELECTORS (for JavaScript):")
print("\nGaming Methods:")
print("  save_player: new Uint8Array([254, 237, 138, 0])")
print("  load_player: new Uint8Array([12, 150, 164, 180])")
print("  get_player_owner: new Uint8Array([238, 66, 48, 113])")
print("  start_battle: new Uint8Array([107, 33, 110, 163])")
print("  update_battle: new Uint8Array([231, 82, 222, 134])")
print("  get_stats: new Uint8Array([239, 18, 208, 203])")

print("\nGeneric Methods:")
print("  save_entity: new Uint8Array([199, 111, 42, 145])")
print("  load_entity: new Uint8Array([43, 86, 42, 180])")
print("  get_entity_owner: new Uint8Array([161, 20, 129, 79])")
print("  start_process: new Uint8Array([97, 229, 150, 82])")
print("  update_process: new Uint8Array([85, 158, 229, 146])")
print("  get_state_counts: new Uint8Array([200, 22, 88, 45])")
print("="*60)

print(f"\n✏️  UPDATE YOUR APP:")
print(f"   For gaming: Use existing code with App ID {app_id}")
print(f"   For blog: Update blog-generic-contract.js with App ID {app_id}")
print("="*60)

# Save deployment info
with open("deployment_universal.txt", "w") as f:
    f.write(f"UniversalStateMachine Contract Deployment\n")
    f.write(f"=========================================\n")
    f.write(f"App ID: {app_id}\n")
    f.write(f"Transaction: {txid}\n")
    f.write(f"Deployer: {sender}\n")
    f.write(f"Network: TestNet\n")
    f.write(f"\nGlobal State Keys:\n")
    f.write(f"  - admin\n")
    f.write(f"  - total_players (synced with total_entities)\n")
    f.write(f"  - total_entities (synced with total_players)\n")
    f.write(f"  - total_battles (synced with total_processes)\n")
    f.write(f"  - total_processes (synced with total_battles)\n")
    f.write(f"\nBox Prefixes:\n")
    f.write(f"  - p: (players - gaming)\n")
    f.write(f"  - b: (battles - gaming)\n")
    f.write(f"  - e: (entities - generic)\n")
    f.write(f"  - pr: (processes - generic)\n")
    f.write(f"\nThis hybrid contract supports BOTH gaming and generic use cases!\n")
    f.write(f"Perfect for backward compatibility + future flexibility.\n")

print("\n📄 Deployment info saved to: deployment_universal.txt")
