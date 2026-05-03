package com.contrapro.app.data.repository

import com.contrapro.app.data.local.AccountDao
import com.contrapro.app.data.local.AccountEntity
import com.contrapro.app.data.local.SyncStatus
import com.contrapro.app.data.local.VoucherDao
import com.contrapro.app.data.local.VoucherEntity
import com.contrapro.app.data.remote.ApiFactory
import com.contrapro.app.data.remote.CreateVoucherRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import java.util.UUID

class ContraRepository(
    private val accountDao: AccountDao,
    private val voucherDao: VoucherDao,
    private val settingsStore: SettingsStore,
) {
    val accounts: Flow<List<AccountEntity>> = accountDao.observeAll()
    val vouchers: Flow<List<VoucherEntity>> = voucherDao.observeAll()
    val settings: Flow<ApiSettings> = settingsStore.settings

    suspend fun saveApiSettings(baseUrl: String, apiKey: String) {
        settingsStore.save(baseUrl, apiKey)
    }

    suspend fun refreshAccounts(): Result<Unit> {
        return runCatching {
            val s = settings.first()
            if (!s.isReady) error("API Base URL and API key are required")
            val api = ApiFactory.create(s.baseUrl)
            val accounts = api.getAccounts(s.apiKey).map {
                AccountEntity(
                    accountId = it.id,
                    name = it.name,
                    type = it.type,
                    updatedAt = it.updatedAt ?: System.currentTimeMillis(),
                )
            }
            accountDao.clearAll()
            accountDao.upsertAll(accounts)
        }
    }

    suspend fun createVoucher(draft: VoucherDraft): Result<Unit> {
        val localVoucher = VoucherEntity(
            localId = UUID.randomUUID().toString(),
            dateMillis = draft.dateMillis,
            refNo = draft.refNo,
            description = draft.description,
            amount = draft.amount,
            fromAccountId = draft.fromAccountId,
            toAccountId = draft.toAccountId,
            syncStatus = SyncStatus.PENDING,
            remoteId = null,
            lastSyncMessage = "Waiting to sync",
        )
        voucherDao.upsert(localVoucher)
        return syncSingle(localVoucher)
    }

    suspend fun syncPendingVouchers(): Result<Unit> {
        return runCatching {
            val pending = voucherDao.getUnSynced()
            pending.forEach { syncSingle(it) }
        }
    }

    private suspend fun syncSingle(voucher: VoucherEntity): Result<Unit> {
        val settings = settings.first()
        if (!settings.isReady) {
            voucherDao.upsert(voucher.copy(syncStatus = SyncStatus.FAILED, lastSyncMessage = "Missing API settings"))
            return Result.failure(IllegalStateException("Missing API settings"))
        }

        return runCatching {
            val api = ApiFactory.create(settings.baseUrl)
            val response = api.createVoucher(
                apiKey = settings.apiKey,
                request = CreateVoucherRequest(
                    dateMillis = voucher.dateMillis,
                    refNo = voucher.refNo,
                    description = voucher.description,
                    amount = voucher.amount,
                    fromAccountId = voucher.fromAccountId,
                    toAccountId = voucher.toAccountId,
                ),
            )
            voucherDao.upsert(
                voucher.copy(
                    syncStatus = SyncStatus.SYNCED,
                    remoteId = response.voucherId,
                    lastSyncMessage = "Synced",
                )
            )
        }.onFailure { err ->
            voucherDao.upsert(
                voucher.copy(
                    syncStatus = SyncStatus.FAILED,
                    lastSyncMessage = err.message ?: "Sync failed",
                )
            )
        }
    }
}

data class VoucherDraft(
    val dateMillis: Long,
    val refNo: String,
    val description: String,
    val amount: Double,
    val fromAccountId: String,
    val toAccountId: String,
)
