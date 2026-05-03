package com.contrapro.app.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.contrapro.app.AppContainer

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val repo = AppContainer.from(applicationContext).repository
        val accountsResult = repo.refreshAccounts()
        val vouchersResult = repo.syncPendingVouchers()

        return if (accountsResult.isSuccess && vouchersResult.isSuccess) {
            Result.success()
        } else {
            Result.retry()
        }
    }
}
