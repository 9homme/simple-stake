const anchor = require("@project-serum/anchor");
const { PublicKey, Transaction, SystemProgram } = anchor.web3;
const { TOKEN_PROGRAM_ID, Token } = require("@solana/spl-token");
const assert = require("assert");

describe('simple-stake', () => {

  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SimpleStake;

  const intializedTokenAmount = 10000;

  let mintA = null;

  let user01TokenAccountA = null;
  let user02TokenAccountA = null;

  let poolVaultAccountPda = null;
  let poolVaultAccountBump = null;
  let poolVaultAuthorityPda = null;


  const poolSharedAccount = anchor.web3.Keypair.generate();
  const user01StakeAccount =  anchor.web3.Keypair.generate();
  const user02StakeAccount =  anchor.web3.Keypair.generate();
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const initializerMainAccount = anchor.web3.Keypair.generate();
  const user01MainAccount = anchor.web3.Keypair.generate();
  const user02MainAccount = anchor.web3.Keypair.generate();

  it('initialize the world!!', async () => {
    // Airdropping tokens to a payer.
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, 10000000000),
      "confirmed"
    );

    // Fund Main Accounts
    await provider.send(
      (() => {
        const tx = new Transaction();
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: user01MainAccount.publicKey,
            lamports: 1000000000,
          }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: user02MainAccount.publicKey,
            lamports: 1000000000,
          }),
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: initializerMainAccount.publicKey,
            lamports: 1000000000,
          })
        );
        return tx;
      })(),
      [payer]
    );

    // Create token A
    mintA = await Token.createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0,
      TOKEN_PROGRAM_ID
    );

    // Create Token accounts
    user01TokenAccountA = await mintA.createAccount(user01MainAccount.publicKey);
    user02TokenAccountA = await mintA.createAccount(user02MainAccount.publicKey);

    // Mint token A to user01 and user02
    await mintA.mintTo(
      user01TokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      intializedTokenAmount
    );

    await mintA.mintTo(
      user02TokenAccountA,
      mintAuthority.publicKey,
      [mintAuthority],
      intializedTokenAmount
    );

    let _user01CurrentToken = await mintA.getAccountInfo(user01TokenAccountA);
    let _user02CurrentToken = await mintA.getAccountInfo(user02TokenAccountA);

    assert.equal(_user01CurrentToken.amount.toNumber(), intializedTokenAmount);
    assert.equal(_user02CurrentToken.amount.toNumber(), intializedTokenAmount);

  });

  it('pool can be initialized by initializer', async () => {
    const [_pool_vault_account_pda, _pool_vault_account_bump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("pool_vault_account"))],
      program.programId
    );

    poolVaultAccountPda = _pool_vault_account_pda;
    poolVaultAccountBump = _pool_vault_account_bump;

    const [_pool_vault_authority_pda, _pool_vault_authority_bumo] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("simple_stake"))],
      program.programId
    );

    poolVaultAuthorityPda = _pool_vault_authority_pda;

    await program.rpc.initialize(
      poolVaultAccountBump,
      {
        accounts: {
          initializer: initializerMainAccount.publicKey,
          mint: mintA.publicKey,
          poolVaultAccount: poolVaultAccountPda,
          poolSharedAccount: poolSharedAccount.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,

        },
        instructions: [
          await program.account.poolSharedAccount.createInstruction(poolSharedAccount),
        ],
        signers: [poolSharedAccount, initializerMainAccount],
      }
    );

    let _vault = await mintA.getAccountInfo(poolVaultAccountPda);

    let _poolSharedAccount = await program.account.poolSharedAccount.fetch(
      poolSharedAccount.publicKey
    );

    assert.ok(_vault.owner.equals(poolVaultAuthorityPda));

    assert.ok(_poolSharedAccount.initializerKey.equals(initializerMainAccount.publicKey));
    assert.ok(_poolSharedAccount.poolVaultAccountKey.equals(poolVaultAccountPda));
    assert.equal(_poolSharedAccount.totalStakedAmount.toNumber(), 0);

  });

  it('can create new user account for user01 successfully', async () => {

    await program.rpc.createUserAccount(
      {
        accounts: {
          user: user01MainAccount.publicKey,
          userAccount: user01StakeAccount.publicKey,
          userTokenAccount: user01TokenAccountA,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY
        },
        instructions: [
          await program.account.userAccount.createInstruction(user01StakeAccount),
        ],
        signers: [user01StakeAccount, user01MainAccount],
      }
    );

    let _user01StakeAccount = await program.account.userAccount.fetch(
      user01StakeAccount.publicKey
    );

    assert.equal(_user01StakeAccount.stakedAmount.toNumber(), 0);

  });

  it('user01 can stake token to the pool', async () => {

    await program.rpc.stake( new anchor.BN(1000),
      {
        accounts: {
          user: user01MainAccount.publicKey,
          userAccount: user01StakeAccount.publicKey,
          userTokenAccount: user01TokenAccountA,
          poolVaultAccount: poolVaultAccountPda,
          poolSharedAccount: poolSharedAccount.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [user01MainAccount],
      }
    );

    let _user01StakeAccount = await program.account.userAccount.fetch(
      user01StakeAccount.publicKey
    );


    assert.equal(_user01StakeAccount.stakedAmount.toNumber() , 1000);

    let _user01CurrentToken = await mintA.getAccountInfo(user01TokenAccountA);
    let _vaultCurrentToken = await mintA.getAccountInfo(poolVaultAccountPda);

    assert.equal(_user01CurrentToken.amount.toNumber(), intializedTokenAmount - 1000);
    assert.equal(_vaultCurrentToken.amount.toNumber(), 1000);

  });

});
