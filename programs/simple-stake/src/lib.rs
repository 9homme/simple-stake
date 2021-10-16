use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token::{Mint, SetAuthority, TokenAccount};
use spl_token::instruction::AuthorityType;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

const SIMPLE_STAKE_PDA_SEED: &[u8] = b"simple_stake";

#[program]
pub mod simple_stake {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, _pool_vault_account_bump: u8) -> ProgramResult {
        // Initialize pool shared account value
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

    pub fn create_user_account(ctx: Context<CreateUserAccount>, bump: u8) -> ProgramResult {
        // Initialize user account value
        ctx.accounts.user_account.user_key = *ctx.accounts.user.key;
        ctx.accounts.user_account.user_token_account_key = *ctx.accounts.user_token_account.to_account_info().key;
        ctx.accounts.user_account.staked_amount = 0;
        ctx.accounts.user_account.bump = bump;

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, staked_amount: u64) -> ProgramResult {
        // Update user account value
        ctx.accounts.user_account.staked_amount = staked_amount;
        // Update pool shared account
        ctx.accounts.pool_shared_account.total_staked_amount = ctx.accounts.pool_shared_account.total_staked_amount + staked_amount;
        // Transfer user's token to vault
        token::transfer(
            ctx.accounts.into_transfer_to_vault_context(),
            staked_amount,
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
    pub user_token_account_key: Pubkey,
    pub staked_amount: u64,
    pub bump: u8,
}



#[derive(Accounts)]
#[instruction(pool_vault_account_bump: u8)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
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

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateUserAccount<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        seeds = [user.key.as_ref()],
        bump = bump,
        payer = user,
        space = 8 + 32 + 32 + 8 + 1,
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(staked_amount: u64)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [user.key.as_ref()],
        bump = user_account.bump,
        constraint = user_account.user_key == *user.key,
        constraint = user_account.user_token_account_key == *user_token_account.to_account_info().key
    )]
    pub user_account: Account<'info, UserAccount>,
    #[account(
        mut,
        constraint = user_token_account.amount >= staked_amount
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_shared_account: ProgramAccount<'info, PoolSharedAccount>,
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: AccountInfo<'info>,
}


impl<'info> Initialize<'info> {
    fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            account_or_mint: self.pool_vault_account.to_account_info().clone(),
            current_authority: self.initializer.to_account_info().clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

impl<'info> Stake<'info> {
    fn into_transfer_to_vault_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.user_token_account.to_account_info().clone(),
            to: self
                .pool_vault_account
                .to_account_info()
                .clone(),
            authority: self.user.to_account_info().clone(),
        };
        let cpi_program = self.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
