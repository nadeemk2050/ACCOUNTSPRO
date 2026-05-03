package com.contrapro.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "vouchers")
data class VoucherEntity(
    @PrimaryKey val localId: String,
    val dateMillis: Long,
    val refNo: String,
    val description: String,
    val amount: Double,
    val fromAccountId: String,
    val toAccountId: String,
    val syncStatus: String,
    val remoteId: String?,
    val lastSyncMessage: String?,
)

object SyncStatus {
    const val PENDING = "PENDING"
    const val SYNCED = "SYNCED"
    const val FAILED = "FAILED"
}
