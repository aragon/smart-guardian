import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { SmartGuardian } from "../typechain";

describe("SmartGuardian", function () {
  let guardianCondition: Contract;
  let signers: SignerWithAddress[];
  let owner: SignerWithAddress;
  let other: SignerWithAddress;

  before(async function () {
    signers = await ethers.getSigners();
    owner = signers[0];
    other = signers[1];
  });

  beforeEach(async function () {
    const Guardian = await ethers.getContractFactory("SmartGuardian");
    guardianCondition = await Guardian.connect(owner).deploy();
  });

  describe("Pausing", async function () {
    it("todo", async function () {});
  });

  describe("Proposal Filtering", async function () {
    it("todo", async function () {});
  });

  describe("Address Filtering", async function () {
    it("todo", async function () {});
  });

  describe("isGranted", async function () {
    it("returns false", async function () {
      const address0 = ethers.constants.AddressZero;

      expect(
        await guardianCondition.isGranted(
          address0,
          address0,
          ethers.utils.id("TEST_PERMISSION_ID"),
          0x0
        )
      ).to.be.false;
    });
  });
});
