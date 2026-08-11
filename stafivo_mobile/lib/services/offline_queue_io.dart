import 'dart:async';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import 'offline_queue_base.dart';
import 'queued_log.dart';

class OfflineQueueImpl extends OfflineQueueImplBase {
  Database? _db;

  @override
  Future<void> init() async {
    if (_db != null) return;

    final dir = await getApplicationDocumentsDirectory();
    final path = p.join(dir.path, 'stafivo_queue.db');
    _db = await openDatabase(
      path,
      version: 2,
      onCreate: (db, version) async {
        await _createTables(db);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          await db.execute('drop table if exists pending_logs;');
          await _createTables(db);
        }
      },
    );
  }

  Future<void> _createTables(Database db) async {
    await db.execute('''
      create table if not exists queued_logs (
        id integer primary key autoincrement,
        payload text not null,
        reason text not null,
        retry_count integer not null default 0,
        last_error text,
        created_at integer not null
      );
    ''');
  }

  @override
  Future<void> addPending({
    required Map<String, dynamic> payload,
    required String reason,
  }) async {
    final db = await _dbOrOpen();
    final data = jsonEncode(payload);
    await db.insert('queued_logs', {
      'payload': data,
      'reason': reason,
      'retry_count': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
    });
  }

  @override
  Future<List<QueuedLog>> pending({bool networkOnly = false}) async {
    final db = await _dbOrOpen();
    final rows = await db.query(
      'queued_logs',
      orderBy: 'created_at asc, id asc',
      where: networkOnly ? 'reason like ?' : null,
      whereArgs: networkOnly ? ['network%'] : null,
    );
    return rows.map(QueuedLog.fromRow).toList();
  }

  @override
  Future<void> deleteIds(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await _dbOrOpen();
    final batch = db.batch();
    for (final id in ids) {
      batch.delete('queued_logs', where: 'id = ?', whereArgs: [id]);
    }
    await batch.commit(noResult: true);
  }

  @override
  Future<void> markFailed({
    required int id,
    required String lastError,
  }) async {
    final db = await _dbOrOpen();
    await db.rawUpdate(
      'update queued_logs set retry_count = retry_count + 1, last_error = ? where id = ?',
      [lastError, id],
    );
  }

  @override
  Future<void> markReason({
    required int id,
    required String reason,
    String? lastError,
  }) async {
    final db = await _dbOrOpen();
    await db.update(
      'queued_logs',
      {
        'reason': reason,
        if (lastError != null) 'last_error': lastError,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<Database> _dbOrOpen() async {
    if (_db != null) return _db!;
    await init();
    return _db!;
  }
}
