package com.contrapro.app.data.remote

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface ContraApi {
    @GET("contra/accounts")
    suspend fun getAccounts(
        @Header("x-api-key") apiKey: String,
    ): List<AccountDto>

    @POST("contra/vouchers")
    suspend fun createVoucher(
        @Header("x-api-key") apiKey: String,
        @Body request: CreateVoucherRequest,
    ): CreateVoucherResponse
}

data class AccountDto(
    val id: String,
    val name: String,
    val type: String,
    val updatedAt: Long?,
)

data class CreateVoucherRequest(
    val dateMillis: Long,
    val refNo: String,
    val description: String,
    val amount: Double,
    val fromAccountId: String,
    val toAccountId: String,
)

data class CreateVoucherResponse(
    val voucherId: String,
)
