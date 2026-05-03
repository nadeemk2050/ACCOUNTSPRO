package com.contrapro.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "accounts")
data class AccountEntity(
    @PrimaryKey val accountId: String,
    val name: String,
    val type: String,
    val updatedAt: Long,
)
