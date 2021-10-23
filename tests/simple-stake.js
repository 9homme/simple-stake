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


  let poolSharedAccountPda = null;
  let poolSharedAccountBump = null;

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
    [poolVaultAccountPda, poolVaultAccountBump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("pool_vault_account"))],
      program.programId
    );


    [poolVaultAuthorityPda, _] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("simple_stake"))],
      program.programId
    );

    [poolSharedAccountPda, poolSharedAccountBump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("pool_shared_account"))],
      program.programId
    );


    await program.rpc.initialize(
      poolVaultAccountBump, poolSharedAccountBump,
      {
        accounts: {
          initializer: initializerMainAccount.publicKey,
          mint: mintA.publicKey,
          poolVaultAccount: poolVaultAccountPda,
          poolSharedAccount: poolSharedAccountPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          tokenProgram: TOKEN_PROGRAM_ID,

        },
        signers: [initializerMainAccount],
      }
    );

    let _vault = await mintA.getAccountInfo(poolVaultAccountPda);

    let _poolSharedAccount = await program.account.poolSharedAccount.fetch(
      poolSharedAccountPda
    );

    assert.ok(_vault.owner.equals(poolVaultAuthorityPda));

    assert.ok(_poolSharedAccount.initializerKey.equals(initializerMainAccount.publicKey));
    assert.ok(_poolSharedAccount.poolVaultAccountKey.equals(poolVaultAccountPda));
    assert.equal(_poolSharedAccount.totalStakedAmount.toNumber(), 0);

  });

  it('can create new user account for user01 successfully', async () => {
    const [_user01StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user01MainAccount.publicKey.toBuffer()],
      program.programId
    );
    await program.rpc.createUserAccount(_bump,
      {
        accounts: {
          user: user01MainAccount.publicKey,
          userAccount: _user01StakeAccountPda,
          userTokenAccount: user01TokenAccountA,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [user01MainAccount],
      }
    );

    let _user01StakeAccount = await program.account.userAccount.fetch(
      _user01StakeAccountPda
    );

    assert.equal(_user01StakeAccount.stakedAmount.toNumber(), 0);

  });

  it('user01 can stake token to the pool', async () => {
    const [_user01StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user01MainAccount.publicKey.toBuffer()],
      program.programId
    );
    await program.rpc.stake(new anchor.BN(1000),
      {
        accounts: {
          user: user01MainAccount.publicKey,
          userAccount: _user01StakeAccountPda,
          userTokenAccount: user01TokenAccountA,
          poolVaultAccount: poolVaultAccountPda,
          poolSharedAccount: poolSharedAccountPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [user01MainAccount],
      }
    );

    let _user01StakeAccount = await program.account.userAccount.fetch(
      _user01StakeAccountPda
    );


    assert.equal(_user01StakeAccount.stakedAmount.toNumber(), 1000);

    let _user01CurrentToken = await mintA.getAccountInfo(user01TokenAccountA);
    let _vaultCurrentToken = await mintA.getAccountInfo(poolVaultAccountPda);

    assert.equal(_user01CurrentToken.amount.toNumber(), intializedTokenAmount - 1000);
    assert.equal(_vaultCurrentToken.amount.toNumber(), 1000);

  });

  it('user02 when account not yet created then should response error when fetching account detail', async () => {
    const [_user02StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user02MainAccount.publicKey.toBuffer()],
      program.programId
    );
    try {
      await program.account.userAccount.fetch(
        _user02StakeAccountPda
      );
      assert.ok(false);
    } catch (err) {
      const errMsg = `Error: Account does not exist ${_user02StakeAccountPda}`;
      assert.equal(err.toString(), errMsg);
    }
  });

  it('user02 when account not yet created should revert transaction', async () => {
    const [_user02StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user02MainAccount.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.rpc.stake(new anchor.BN(1000),
        {
          accounts: {
            user: user02MainAccount.publicKey,
            userAccount: _user02StakeAccountPda,
            userTokenAccount: user02TokenAccountA,
            poolVaultAccount: poolVaultAccountPda,
            poolSharedAccount: poolSharedAccountPda,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user02MainAccount],
        }
      );
      assert.ok(false);
    } catch (err) {
      const errMsg = "The given account is not owned by the executing program";
      assert.equal(err.toString(), errMsg);
    }

  });

  it('after create an account, user02 will now able to stake token to contract', async () => {
    const [_user02StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user02MainAccount.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.createUserAccount(_bump,
      {
        accounts: {
          user: user02MainAccount.publicKey,
          userAccount: _user02StakeAccountPda,
          userTokenAccount: user02TokenAccountA,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [user02MainAccount],
      }
    );

    await program.rpc.stake(new anchor.BN(2000),
      {
        accounts: {
          user: user02MainAccount.publicKey,
          userAccount: _user02StakeAccountPda,
          userTokenAccount: user02TokenAccountA,
          poolVaultAccount: poolVaultAccountPda,
          poolSharedAccount: poolSharedAccountPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [user02MainAccount],
      }
    );

    let _user02StakeAccount = await program.account.userAccount.fetch(
      _user02StakeAccountPda
    );


    assert.equal(_user02StakeAccount.stakedAmount.toNumber(), 2000);

    let _user02CurrentToken = await mintA.getAccountInfo(user02TokenAccountA);
    let _vaultCurrentToken = await mintA.getAccountInfo(poolVaultAccountPda);

    assert.equal(_user02CurrentToken.amount.toNumber(), intializedTokenAmount - 2000);
    assert.equal(_vaultCurrentToken.amount.toNumber(), 1000 + 2000);

  });

  it('user02 with unauthorized user account should revert transaction', async () => {
    const [_user01StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user01MainAccount.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.rpc.stake(new anchor.BN(1000),
        {
          accounts: {
            user: user02MainAccount.publicKey,
            userAccount: _user01StakeAccountPda,
            userTokenAccount: user02TokenAccountA,
            poolVaultAccount: poolVaultAccountPda,
            poolSharedAccount: poolSharedAccountPda,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user02MainAccount],
        }
      );
      assert.ok(false);
    } catch (err) {
      const errMsg = "A seeds constraint was violated";
      assert.equal(err.toString(), errMsg);
    }

  });

  it('user02 with invalid amount should revert transaction', async () => {
    const [_user02StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user02MainAccount.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.rpc.stake(new anchor.BN(100000),
        {
          accounts: {
            user: user02MainAccount.publicKey,
            userAccount: _user02StakeAccountPda,
            userTokenAccount: user02TokenAccountA,
            poolVaultAccount: poolVaultAccountPda,
            poolSharedAccount: poolSharedAccountPda,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user02MainAccount],
        }
      );
      assert.ok(false);
    } catch (err) {
      const errMsg = "A raw constraint was violated";
      assert.equal(err.toString(), errMsg);
    }

  });

  it('user02 can unstake some token from contract', async () => {
    const [_user02StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user02MainAccount.publicKey.toBuffer()],
      program.programId
    );

    await program.rpc.unstake(new anchor.BN(1000),
      {
        accounts: {
          user: user02MainAccount.publicKey,
          userAccount: _user02StakeAccountPda,
          userTokenAccount: user02TokenAccountA,
          poolVaultAccount: poolVaultAccountPda,
          poolVaultAuthority: poolVaultAuthorityPda,
          poolSharedAccount: poolSharedAccountPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        signers: [user02MainAccount],
      }
    );

    let _user02StakeAccount = await program.account.userAccount.fetch(
      _user02StakeAccountPda
    );


    assert.equal(_user02StakeAccount.stakedAmount.toNumber(), 1000);

    let _user02CurrentToken = await mintA.getAccountInfo(user02TokenAccountA);
    let _vaultCurrentToken = await mintA.getAccountInfo(poolVaultAccountPda);

    assert.equal(_user02CurrentToken.amount.toNumber(), intializedTokenAmount - 2000 + 1000);
    assert.equal(_vaultCurrentToken.amount.toNumber(), 1000 + 2000 - 1000);

  });

  it('user01 should not be able to unstake token more than staked amount', async () => {
    const [_user01StakeAccountPda, _bump] = await PublicKey.findProgramAddress(
      [user01MainAccount.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.rpc.unstake(new anchor.BN(2000),
        {
          accounts: {
            user: user01MainAccount.publicKey,
            userAccount: _user01StakeAccountPda,
            userTokenAccount: user01TokenAccountA,
            poolVaultAccount: poolVaultAccountPda,
            poolVaultAuthority: poolVaultAuthorityPda,
            poolSharedAccount: poolSharedAccountPda,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          signers: [user01MainAccount],
        }
      );
      assert.ok(false);
    } catch (err) {
      const errMsg = "A raw constraint was violated";
      assert.equal(err.toString(), errMsg);
    }


  });

});
