package com.contrapro.app.data.repository

import android.content.Context
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "contra_settings")

class SettingsStore(private val context: Context) {
    val settings: Flow<ApiSettings> = context.dataStore.data.map { prefs ->
        ApiSettings(
            baseUrl = prefs[Keys.BASE_URL].orEmpty(),
            apiKey = prefs[Keys.API_KEY].orEmpty(),
        )
    }

    suspend fun save(baseUrl: String, apiKey: String) {
        context.dataStore.edit { prefs: MutablePreferences ->
            prefs[Keys.BASE_URL] = baseUrl.trim()
            prefs[Keys.API_KEY] = apiKey.trim()
        }
    }

    private object Keys {
        val BASE_URL: Preferences.Key<String> = stringPreferencesKey("base_url")
        val API_KEY: Preferences.Key<String> = stringPreferencesKey("api_key")
    }
}

data class ApiSettings(
    val baseUrl: String,
    val apiKey: String,
) {
    val isReady: Boolean get() = baseUrl.isNotBlank() && apiKey.isNotBlank()
}
