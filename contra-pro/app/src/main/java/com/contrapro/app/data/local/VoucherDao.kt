package com.contrapro.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface VoucherDao {
    @Query("SELECT * FROM vouchers ORDER BY dateMillis DESC")
    fun observeAll(): Flow<List<VoucherEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(voucher: VoucherEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(vouchers: List<VoucherEntity>)

    @Query("SELECT * FROM vouchers WHERE syncStatus != :status ORDER BY dateMillis ASC")
    suspend fun getUnSynced(status: String = SyncStatus.SYNCED): List<VoucherEntity>
}
