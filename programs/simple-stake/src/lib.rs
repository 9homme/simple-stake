use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Mint, SetAuthority, TokenAccount};
use spl_token::instruction::AuthorityType;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

const SIMPLE_STAKE_PDA_SEED: &[u8] = b"simple_stake";

#[program]
pub mod simple_stake {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, _pool_vault_account_bump: u8) -> ProgramResult {
        // Initialize stake account value
        ctx.accounts.pool_shared_account.initializer_key = *ctx.accounts.initializer.key;
        ctx.accounts.pool_shared_account.pool_vault_account_key =
            *ctx.accounts.pool_vault_account.to_account_info().key;
        ctx.accounts.pool_shared_account.total_staked_amount = 0;

        // This will transfer owner of vault that created by initializer to program [PDA]
        let (vault_authority, _vault_authority_bump) =
            Pubkey::find_program_address(&[SIMPLE_STAKE_PDA_SEED], ctx.program_id);

        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;

        Ok(())
    }
}

#[account]
pub struct PoolSharedAccount {
    pub initializer_key: Pubkey,
    pub pool_vault_account_key: Pubkey,
    pub total_staked_amount: u64,
}

#[account]
pub struct UserAccount {
    pub user_key: Pubkey,
    pub staked_amount: u64,
}



#[derive(Accounts)]
#[instruction(pool_vault_account_bump: u8)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub initializer: AccountInfo<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        seeds = [b"pool_vault_account".as_ref()],
        bump = pool_vault_account_bump,
        payer = initializer,
        token::mint = mint,
        token::authority = initializer,
    )]
    pub pool_vault_account: Account<'info, TokenAccount>,
    #[account(zero)]
    pub pool_shared_account: ProgramAccount<'info, PoolSharedAccount>,
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: AccountInfo<'info>,
}

impl<'info> Initialize<'info> {
    fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            account_or_mint: self.pool_vault_account.to_account_info().clone(),
            current_authority: self.initializer.clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
