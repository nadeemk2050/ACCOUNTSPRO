package com.contrapro.app

import android.content.Context
import androidx.room.Room
import com.contrapro.app.data.local.AppDatabase
import com.contrapro.app.data.repository.ContraRepository
import com.contrapro.app.data.repository.SettingsStore

class AppContainer private constructor(context: Context) {
    private val db: AppDatabase = Room.databaseBuilder(
        context.applicationContext,
        AppDatabase::class.java,
        "contra_pro.db",
    ).build()

    val repository: ContraRepository = ContraRepository(
        accountDao = db.accountDao(),
        voucherDao = db.voucherDao(),
        settingsStore = SettingsStore(context.applicationContext),
    )

    companion object {
        @Volatile
        private var instance: AppContainer? = null

        fun from(context: Context): AppContainer {
            return instance ?: synchronized(this) {
                instance ?: AppContainer(context).also { instance = it }
            }
        }
    }
}
