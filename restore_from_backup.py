#!/usr/bin/env python3
"""
Smart database restore script that handles schema changes.
Restores data from a backup database even when new tables/columns exist.
"""
import sqlite3
import sys
import os
from datetime import datetime

def get_table_info(conn, table_name):
    """Get column names and types for a table."""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = {row[1]: row[2] for row in cursor.fetchall()}
    return columns

def get_all_tables(conn):
    """Get all table names from database."""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    return [row[0] for row in cursor.fetchall()]

def get_primary_key(conn, table_name):
    """Get primary key column(s) for a table."""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    pk_cols = [row[1] for row in cursor.fetchall() if row[5] > 0]
    return pk_cols

def restore_database(backup_path, main_db_path, skip_tables=None, verbose=True):
    """
    Restore data from backup database to main database.
    Handles schema differences intelligently.
    
    Args:
        backup_path: Path to backup database file
        main_db_path: Path to main database file
        skip_tables: List of table names to skip
        verbose: Print detailed progress
    """
    if not os.path.exists(backup_path):
        print(f"❌ Backup file not found: {backup_path}")
        return False
    
    if not os.path.exists(main_db_path):
        print(f"❌ Main database not found: {main_db_path}")
        return False
    
    skip_tables = skip_tables or []
    
    print(f"🔄 Starting database restore from backup...")
    print(f"   Backup: {backup_path}")
    print(f"   Target: {main_db_path}")
    print()
    
    # Connect to both databases
    backup_conn = sqlite3.connect(backup_path)
    main_conn = sqlite3.connect(main_db_path)
    
    try:
        # Get table lists
        backup_tables = get_all_tables(backup_conn)
        main_tables = get_all_tables(main_conn)
        
        if verbose:
            print(f"📊 Backup DB has {len(backup_tables)} tables")
            print(f"📊 Main DB has {len(main_tables)} tables")
            new_tables = set(main_tables) - set(backup_tables)
            if new_tables:
                print(f"   ⚠️  New tables (will be skipped): {', '.join(new_tables)}")
            print()
        
        # Disable foreign key constraints temporarily
        main_conn.execute("PRAGMA foreign_keys = OFF")
        
        stats = {
            'tables_processed': 0,
            'rows_restored': 0,
            'tables_skipped': 0,
            'errors': []
        }
        
        # Process each table in backup
        for table in backup_tables:
            if table in skip_tables:
                if verbose:
                    print(f"⏭️  Skipping {table} (in skip list)")
                stats['tables_skipped'] += 1
                continue
            
            if table not in main_tables:
                if verbose:
                    print(f"⚠️  Table '{table}' doesn't exist in main DB, skipping")
                stats['tables_skipped'] += 1
                continue
            
            try:
                # Get column info for both databases
                backup_cols = get_table_info(backup_conn, table)
                main_cols = get_table_info(main_conn, table)
                
                # Find common columns
                common_cols = list(set(backup_cols.keys()) & set(main_cols.keys()))
                
                if not common_cols:
                    if verbose:
                        print(f"⚠️  No common columns in '{table}', skipping")
                    stats['tables_skipped'] += 1
                    continue
                
                # Get primary key to check for conflicts
                pk_cols = get_primary_key(backup_conn, table)
                
                if verbose:
                    new_cols = set(main_cols.keys()) - set(backup_cols.keys())
                    print(f"📦 Processing: {table}")
                    print(f"   Common columns: {len(common_cols)}/{len(main_cols)}")
                    if new_cols:
                        print(f"   New columns (will use defaults): {', '.join(new_cols)}")
                
                # Count rows in backup
                cursor = backup_conn.cursor()
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                row_count = cursor.fetchone()[0]
                
                if row_count == 0:
                    if verbose:
                        print(f"   ⏭️  Empty table, skipping")
                    stats['tables_skipped'] += 1
                    continue
                
                # Clear existing data in main DB for this table
                main_conn.execute(f"DELETE FROM {table}")
                
                # Build query to copy data
                cols_str = ', '.join(common_cols)
                placeholders = ', '.join(['?' for _ in common_cols])
                
                # Read all data from backup
                cursor.execute(f"SELECT {cols_str} FROM {table}")
                rows = cursor.fetchall()
                
                # Insert into main database
                inserted = 0
                for row in rows:
                    try:
                        main_conn.execute(
                            f"INSERT INTO {table} ({cols_str}) VALUES ({placeholders})",
                            row
                        )
                        inserted += 1
                    except sqlite3.IntegrityError as e:
                        # Handle duplicate key or constraint violations
                        if verbose:
                            print(f"   ⚠️  Skipped row due to constraint: {str(e)[:80]}")
                        continue
                
                main_conn.commit()
                
                if verbose:
                    print(f"   ✅ Restored {inserted}/{row_count} rows")
                
                stats['tables_processed'] += 1
                stats['rows_restored'] += inserted
                
            except Exception as e:
                error_msg = f"Error processing table '{table}': {str(e)}"
                stats['errors'].append(error_msg)
                if verbose:
                    print(f"   ❌ {error_msg}")
                main_conn.rollback()
        
        # Re-enable foreign keys
        main_conn.execute("PRAGMA foreign_keys = ON")
        
        print()
        print("=" * 60)
        print("📊 Restore Summary:")
        print(f"   Tables processed: {stats['tables_processed']}")
        print(f"   Tables skipped: {stats['tables_skipped']}")
        print(f"   Total rows restored: {stats['rows_restored']}")
        if stats['errors']:
            print(f"   ⚠️  Errors encountered: {len(stats['errors'])}")
            for err in stats['errors'][:5]:
                print(f"      - {err}")
            if len(stats['errors']) > 5:
                print(f"      ... and {len(stats['errors'] - 5)} more")
        print("=" * 60)
        
        return len(stats['errors']) == 0
        
    except Exception as e:
        print(f"❌ Fatal error during restore: {e}")
        return False
    finally:
        backup_conn.close()
        main_conn.close()


def create_backup(db_path, backup_dir='instance/backups'):
    """Create a timestamped backup of the database."""
    if not os.path.exists(db_path):
        print(f"❌ Database not found: {db_path}")
        return None
    
    os.makedirs(backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_name = f"db_backup_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_name)
    
    print(f"📦 Creating backup: {backup_path}")
    
    src_conn = sqlite3.connect(db_path)
    dst_conn = sqlite3.connect(backup_path)
    
    src_conn.backup(dst_conn)
    
    src_conn.close()
    dst_conn.close()
    
    print(f"✅ Backup created successfully")
    return backup_path


def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print(f"  {sys.argv[0]} <backup_db_path> [main_db_path]")
        print()
        print("Example:")
        print(f"  {sys.argv[0]} instance/backups/db_backup_20241212_120000.db")
        print(f"  {sys.argv[0]} instance/backups/db_backup_20241212_120000.db instance/app.db")
        print()
        print("The script will:")
        print("  - Create a safety backup of the current database")
        print("  - Restore data from the specified backup")
        print("  - Handle new tables/columns automatically")
        print("  - Preserve data integrity with smart conflict resolution")
        sys.exit(1)
    
    backup_path = sys.argv[1]
    main_db_path = sys.argv[2] if len(sys.argv) > 2 else 'instance/app.db'
    
    # Safety check
    if not os.path.exists(main_db_path):
        print(f"❌ Main database not found: {main_db_path}")
        print("   Make sure you're running from the project root directory")
        sys.exit(1)
    
    # Create safety backup first
    print("🛡️  Creating safety backup of current database...")
    safety_backup = create_backup(main_db_path)
    if not safety_backup:
        print("❌ Failed to create safety backup, aborting")
        sys.exit(1)
    
    print()
    print("⚠️  WARNING: This will replace all data in the main database!")
    response = input("Continue? (yes/no): ")
    
    if response.lower() not in ['yes', 'y']:
        print("❌ Restore cancelled")
        print(f"   Safety backup kept at: {safety_backup}")
        sys.exit(0)
    
    print()
    success = restore_database(backup_path, main_db_path, verbose=True)
    
    if success:
        print()
        print("✅ Database restore completed successfully!")
        print(f"   Safety backup available at: {safety_backup}")
    else:
        print()
        print("⚠️  Restore completed with errors")
        print(f"   If needed, you can restore from safety backup: {safety_backup}")
        sys.exit(1)


if __name__ == '__main__':
    main()
