package com.contrapro.app.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.contrapro.app.data.local.AccountEntity
import com.contrapro.app.data.local.VoucherEntity
import com.contrapro.app.data.repository.ApiSettings
import com.contrapro.app.data.repository.ContraRepository
import com.contrapro.app.data.repository.VoucherDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class ContraViewModel(private val repository: ContraRepository) : ViewModel() {
    val accounts = repository.accounts.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val vouchers = repository.vouchers.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val settings = repository.settings.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5000),
        ApiSettings(baseUrl = "", apiKey = ""),
    )

    private val _ui = MutableStateFlow(ContraUiState())
    val ui: StateFlow<ContraUiState> = _ui

    fun onRefNoChange(value: String) = _ui.update { it.copy(refNo = value) }
    fun onDescriptionChange(value: String) = _ui.update { it.copy(description = value) }
    fun onAmountChange(value: String) = _ui.update { it.copy(amount = value) }
    fun onFromAccountChange(value: String) = _ui.update { it.copy(fromAccountId = value) }
    fun onToAccountChange(value: String) = _ui.update { it.copy(toAccountId = value) }
    fun onTabChange(tab: ContraTab) = _ui.update { it.copy(tab = tab) }
    fun onBaseUrlChange(value: String) = _ui.update { it.copy(baseUrlInput = value) }
    fun onApiKeyChange(value: String) = _ui.update { it.copy(apiKeyInput = value) }
    fun toggleSettingsDialog(show: Boolean) = _ui.update { it.copy(showSettingsDialog = show) }

    fun hydrateSettings(settings: ApiSettings) {
        _ui.update {
            it.copy(
                baseUrlInput = settings.baseUrl,
                apiKeyInput = settings.apiKey,
            )
        }
    }

    fun saveSettings() {
        viewModelScope.launch {
            repository.saveApiSettings(_ui.value.baseUrlInput, _ui.value.apiKeyInput)
            refreshAccounts()
            _ui.update { it.copy(message = "Settings saved", showSettingsDialog = false) }
        }
    }

    fun refreshAccounts() {
        viewModelScope.launch {
            val result = repository.refreshAccounts()
            _ui.update {
                it.copy(
                    message = if (result.isSuccess) "Accounts updated" else "Account sync failed",
                )
            }
        }
    }

    fun submitVoucher() {
        viewModelScope.launch {
            val amount = _ui.value.amount.toDoubleOrNull()
            if (amount == null || amount <= 0.0) {
                _ui.update { it.copy(message = "Enter a valid amount") }
                return@launch
            }
            if (_ui.value.fromAccountId.isBlank() || _ui.value.toAccountId.isBlank()) {
                _ui.update { it.copy(message = "Select both accounts") }
                return@launch
            }

            val result = repository.createVoucher(
                VoucherDraft(
                    dateMillis = System.currentTimeMillis(),
                    refNo = _ui.value.refNo.ifBlank { "AUTO-${System.currentTimeMillis()}" },
                    description = _ui.value.description,
                    amount = amount,
                    fromAccountId = _ui.value.fromAccountId,
                    toAccountId = _ui.value.toAccountId,
                )
            )

            _ui.update {
                it.copy(
                    message = if (result.isSuccess) "Voucher saved" else "Voucher queued for sync",
                    refNo = "",
                    description = "",
                    amount = "",
                )
            }
        }
    }

    fun syncNow() {
        viewModelScope.launch {
            val result = repository.syncPendingVouchers()
            _ui.update {
                it.copy(message = if (result.isSuccess) "Sync complete" else "Sync failed")
            }
        }
    }

    fun clearMessage() {
        _ui.update { it.copy(message = null) }
    }

    class Factory(private val repository: ContraRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return ContraViewModel(repository) as T
        }
    }
}

data class ContraUiState(
    val tab: ContraTab = ContraTab.Voucher,
    val refNo: String = "",
    val description: String = "",
    val amount: String = "",
    val fromAccountId: String = "",
    val toAccountId: String = "",
    val showSettingsDialog: Boolean = false,
    val baseUrlInput: String = "",
    val apiKeyInput: String = "",
    val message: String? = null,
)

enum class ContraTab { Voucher, History }

fun List<AccountEntity>.accountName(id: String): String = firstOrNull { it.accountId == id }?.name ?: id
fun VoucherEntity.syncLabel(): String = syncStatus + (lastSyncMessage?.let { ": $it" } ?: "")
