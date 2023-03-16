import {expect} from 'chai';
import {ethers} from 'hardhat';
import {BigNumber, ContractFactory} from 'ethers';
import {upgrades} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';

import {
  DAO,
  DAO__factory,
  GovernanceERC20Mock,
  GovernanceERC20Mock__factory,
  TokenVoting,
  TokenVoting__factory,
  SmartGuardian,
  SmartGuardian__factory,
} from '../typechain';

type DeployOptions = {
  constructurArgs?: unknown[];
  proxyType?: 'uups';
};

// Used to deploy the implementation with the ERC1967 Proxy behind it.
// It is designed this way, because it might be desirable to avoid the OpenZeppelin upgrades package.
// In the future, this function might get replaced.
// NOTE: To avoid lots of changes in the whole test codebase, `deployWithProxy`
// won't automatically call `initialize` and it's the caller's responsibility to do so.
export async function deployWithProxy<T>(
  contractFactory: ContractFactory,
  options: DeployOptions = {}
): Promise<T> {
  // NOTE: taking this out of this file and putting this in each test file's
  // before hook seems a good idea for efficiency, though, all test files become
  // highly dependent on this package which is undesirable for now.
  upgrades.silenceWarnings();

  return upgrades.deployProxy(contractFactory, [], {
    kind: options.proxyType || 'uups',
    initializer: false,
    unsafeAllow: ['constructor'],
    constructorArgs: options.constructurArgs || [],
  }) as unknown as Promise<T>;
}

export async function getTime(): Promise<number> {
  return (await ethers.provider.getBlock('latest')).timestamp;
}

export async function advanceTime(time: number) {
  await ethers.provider.send('evm_increaseTime', [time]);
  await ethers.provider.send('evm_mine', []);
}

export async function advanceTimeTo(timestamp: number) {
  const delta = timestamp - (await getTime());
  await advanceTime(delta);
}

export async function advanceIntoVoteTime(startDate: number, endDate: number) {
  await advanceTimeTo(startDate);
  expect(await getTime()).to.be.greaterThanOrEqual(startDate);
  expect(await getTime()).to.be.lessThan(endDate);
}

export async function advanceAfterVoteEnd(endDate: number) {
  await advanceTimeTo(endDate);
  expect(await getTime()).to.be.greaterThanOrEqual(endDate);
}

export enum VoteOption {
  None,
  Abstain,
  Yes,
  No,
}

export enum VotingMode {
  Standard,
  EarlyExecution,
  VoteReplacement,
}

export type VotingSettings = {
  votingMode: number;
  supportThreshold: BigNumber;
  minParticipation: BigNumber;
  minDuration: number;
  minProposerVotingPower: number;
};

export const RATIO_BASE = ethers.BigNumber.from(10).pow(6); // 100% => 10**6
export const pctToRatio = (x: number) => RATIO_BASE.mul(x).div(100);

export function toBytes32(num: number): string {
  const hex = num.toString(16);
  return `0x${'0'.repeat(64 - hex.length)}${hex}`;
}

export const ONE_HOUR = 60 * 60;

describe('TokenVoting', function () {
  let signers: SignerWithAddress[];
  let voting: TokenVoting;
  let guardian: SmartGuardian;
  let dao: DAO;
  let governanceErc20Mock: GovernanceERC20Mock;
  let startDate: number;
  let endDate: number;
  let votingSettings: VotingSettings;
  let dummyActions: any;
  let dummyMetadata: string;

  const startOffset = 20;
  const id = 0;
  const EXECUTE_PERMISSION_ID = ethers.utils.id('EXECUTE_PERMISSION');

  before(async () => {
    signers = await ethers.getSigners();

    const DAO = new DAO__factory(signers[0]);
    dao = await deployWithProxy<DAO>(DAO);

    const daoExampleURI = 'https://example.com';

    await dao.initialize(
      '0x00',
      signers[0].address,
      ethers.constants.AddressZero,
      daoExampleURI
    );

    dummyActions = [
      {
        to: signers[0].address,
        data: '0x00000000',
        value: 0,
      },
    ];

    dummyMetadata = ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes('0x123456789')
    );
  });

  beforeEach(async function () {
    votingSettings = {
      votingMode: VotingMode.EarlyExecution,
      supportThreshold: pctToRatio(50),
      minParticipation: pctToRatio(20),
      minDuration: ONE_HOUR,
      minProposerVotingPower: 0,
    };

    const GovernanceERC20Mock = new GovernanceERC20Mock__factory(signers[0]);
    governanceErc20Mock = await GovernanceERC20Mock.deploy(
      dao.address,
      'GOV',
      'GOV',
      {
        receivers: [],
        amounts: [],
      }
    );

    const TokenVoting = new TokenVoting__factory(signers[0]);
    voting = await deployWithProxy<TokenVoting>(TokenVoting);

    const SmartGuardian = new SmartGuardian__factory(signers[0]);
    guardian = await SmartGuardian.deploy();

    startDate = (await getTime()) + startOffset;
    endDate = startDate + votingSettings.minDuration;

    dao.grantWithCondition(
      dao.address,
      voting.address,
      EXECUTE_PERMISSION_ID,
      guardian.address
    );
  });

  async function setBalances(
    balances: {receiver: string; amount: number | BigNumber}[]
  ) {
    const promises = balances.map(balance =>
      governanceErc20Mock.setBalance(balance.receiver, balance.amount)
    );
    await Promise.all(promises);
  }

  async function setTotalSupply(totalSupply: number) {
    await ethers.provider.send('evm_mine', []);
    let block = await ethers.provider.getBlock('latest');

    const currentTotalSupply: BigNumber =
      await governanceErc20Mock.getPastTotalSupply(block.number - 1);

    await governanceErc20Mock.setBalance(
      `0x${'0'.repeat(39)}1`, // address(1)
      BigNumber.from(totalSupply).sub(currentTotalSupply)
    );
  }

  describe('Proposal + Execute:', async () => {
    beforeEach(async () => {
      const balances = [
        {
          receiver: signers[0].address,
          amount: 100,
        },
      ];

      await setBalances(balances);
      await setTotalSupply(100);

      await voting.initialize(
        dao.address,
        votingSettings,
        governanceErc20Mock.address
      );

      expect(
        (
          await voting.createProposal(
            dummyMetadata,
            dummyActions,
            0,
            startDate,
            endDate,
            VoteOption.None,
            false
          )
        ).value
      ).to.equal(id);
    });

    it('reverts if the proposal executor not allowed', async () => {
      await advanceIntoVoteTime(startDate, endDate);

      await expect(voting.connect(signers[0]).vote(id, VoteOption.Yes, true))
        .to.be.revertedWithCustomError(dao, 'Unauthorized')
        .withArgs(dao.address, voting.address, EXECUTE_PERMISSION_ID);
    });

    it('executes if the proposal executor is allowed', async () => {
      await advanceIntoVoteTime(startDate, endDate);

      await guardian.addExecutor(signers[0].address);

      await expect(voting.connect(signers[0]).vote(id, VoteOption.Yes, true)).to
        .not.be.reverted;
    });

    it('reverts if the proposal ID is blocked', async () => {
      await advanceIntoVoteTime(startDate, endDate);

      await guardian.blockProposal(toBytes32(0));

      await expect(voting.connect(signers[0]).vote(id, VoteOption.Yes, true))
        .to.be.revertedWithCustomError(dao, 'Unauthorized')
        .withArgs(dao.address, voting.address, EXECUTE_PERMISSION_ID);
    });

    it('reverts if execution is paused', async () => {
      await advanceIntoVoteTime(startDate, endDate);

      await guardian.addExecutor(signers[0].address);
      guardian.pause();

      await expect(voting.connect(signers[0]).vote(id, VoteOption.Yes, true))
        .to.be.revertedWithCustomError(dao, 'Unauthorized')
        .withArgs(dao.address, voting.address, EXECUTE_PERMISSION_ID);
    });

    it('executes again after execution is unpaused', async () => {
      await advanceIntoVoteTime(startDate, endDate);

      await guardian.addExecutor(signers[0].address);

      await guardian.pause();

      await expect(voting.connect(signers[0]).vote(id, VoteOption.Yes, true))
        .to.be.revertedWithCustomError(dao, 'Unauthorized')
        .withArgs(dao.address, voting.address, EXECUTE_PERMISSION_ID);

      await guardian.unpause();

      await voting.connect(signers[0]).vote(id, VoteOption.Yes, true);
    });
  });
});
