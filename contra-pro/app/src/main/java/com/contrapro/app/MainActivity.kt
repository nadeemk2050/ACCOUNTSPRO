package com.contrapro.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.contrapro.app.sync.SyncWorker
import com.contrapro.app.ui.screen.ContraApp
import com.contrapro.app.ui.screen.ContraViewModel
import com.contrapro.app.ui.theme.ContraProTheme
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {
    private val viewModel: ContraViewModel by viewModels {
        ContraViewModel.Factory(AppContainer.from(applicationContext).repository)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        scheduleSync()
        viewModel.refreshAccounts()

        setContent {
            ContraProTheme {
                ContraApp(viewModel = viewModel)
            }
        }
    }

    private fun scheduleSync() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "contra-sync-worker",
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }
}
