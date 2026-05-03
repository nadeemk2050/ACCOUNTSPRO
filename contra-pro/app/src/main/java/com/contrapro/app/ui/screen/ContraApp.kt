package com.contrapro.app.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun ContraApp(viewModel: ContraViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val accounts by viewModel.accounts.collectAsStateWithLifecycle()
    val vouchers by viewModel.vouchers.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    val snackState = remember { SnackbarHostState() }

    LaunchedEffect(settings.baseUrl, settings.apiKey) {
        viewModel.hydrateSettings(settings)
    }

    LaunchedEffect(ui.message) {
        ui.message?.let {
            snackState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Contra Pro") },
                actions = {
                    TextButton(onClick = { viewModel.toggleSettingsDialog(true) }) { Text("API") }
                    TextButton(onClick = viewModel::refreshAccounts) { Text("Refresh") }
                    TextButton(onClick = viewModel::syncNow) { Text("Sync") }
                }
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackState) },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            TabRow(selectedTabIndex = if (ui.tab == ContraTab.Voucher) 0 else 1) {
                Tab(selected = ui.tab == ContraTab.Voucher, onClick = { viewModel.onTabChange(ContraTab.Voucher) }, text = { Text("Voucher") })
                Tab(selected = ui.tab == ContraTab.History, onClick = { viewModel.onTabChange(ContraTab.History) }, text = { Text("History") })
            }

            if (ui.tab == ContraTab.Voucher) {
                VoucherPage(viewModel = viewModel, accounts = accounts)
            } else {
                HistoryPage(vouchers = vouchers, accounts = accounts)
            }
        }
    }

    if (ui.showSettingsDialog) {
        SettingsDialog(
            baseUrl = ui.baseUrlInput,
            apiKey = ui.apiKeyInput,
            onBaseUrl = viewModel::onBaseUrlChange,
            onApiKey = viewModel::onApiKeyChange,
            onSave = viewModel::saveSettings,
            onDismiss = { viewModel.toggleSettingsDialog(false) },
        )
    }
}

@Composable
private fun VoucherPage(viewModel: ContraViewModel, accounts: List<com.contrapro.app.data.local.AccountEntity>) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Create Contra Voucher", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        OutlinedTextField(value = ui.refNo, onValueChange = viewModel::onRefNoChange, label = { Text("Ref No") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = ui.description, onValueChange = viewModel::onDescriptionChange, label = { Text("Description") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = ui.amount, onValueChange = viewModel::onAmountChange, label = { Text("Amount") }, modifier = Modifier.fillMaxWidth())
        AccountSelector(
            label = "From (Cash/Bank)",
            selectedId = ui.fromAccountId,
            accounts = accounts,
            onSelected = viewModel::onFromAccountChange,
        )
        AccountSelector(
            label = "To (Cash/Bank)",
            selectedId = ui.toAccountId,
            accounts = accounts,
            onSelected = viewModel::onToAccountChange,
        )
        Button(onClick = viewModel::submitVoucher, modifier = Modifier.fillMaxWidth()) {
            Text("Save Voucher")
        }
    }
}

@Composable
private fun AccountSelector(
    label: String,
    selectedId: String,
    accounts: List<com.contrapro.app.data.local.AccountEntity>,
    onSelected: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        LazyColumn(modifier = Modifier.fillMaxWidth().height(150.dp)) {
            items(accounts) { account ->
                TextButton(onClick = { onSelected(account.accountId) }) {
                    val marker = if (selectedId == account.accountId) "[Selected] " else ""
                    Text("$marker${account.name} (${account.type})")
                }
            }
        }
    }
}

@Composable
private fun HistoryPage(
    vouchers: List<com.contrapro.app.data.local.VoucherEntity>,
    accounts: List<com.contrapro.app.data.local.AccountEntity>,
) {
    val formatter = remember { SimpleDateFormat("dd-MM-yyyy", Locale.getDefault()) }

    Column(modifier = Modifier.padding(12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Date", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("Ref", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("Description", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1.5f))
            Text("Amount", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("Sync", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1.5f))
        }

        LazyColumn {
            items(vouchers) { voucher ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(formatter.format(Date(voucher.dateMillis)), modifier = Modifier.weight(1f))
                    Text(voucher.refNo, modifier = Modifier.weight(1f))
                    Text("${voucher.description} (${accounts.accountName(voucher.fromAccountId)} -> ${accounts.accountName(voucher.toAccountId)})", modifier = Modifier.weight(1.5f))
                    Text(String.format(Locale.getDefault(), "%.2f", voucher.amount), modifier = Modifier.weight(1f))
                    Text(voucher.syncLabel(), modifier = Modifier.weight(1.5f))
                }
            }
        }
    }
}

@Composable
private fun SettingsDialog(
    baseUrl: String,
    apiKey: String,
    onBaseUrl: (String) -> Unit,
    onApiKey: (String) -> Unit,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("API Connection") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = baseUrl, onValueChange = onBaseUrl, label = { Text("Base URL") })
                OutlinedTextField(value = apiKey, onValueChange = onApiKey, label = { Text("API Key") })
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
        confirmButton = {
            Button(onClick = onSave) { Text("Save") }
        },
    )
}
