// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity 0.8.17;

import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPermissionCondition} from "@aragon/osx/core/permission/IPermissionCondition.sol";
import {IDAO, DAO} from "@aragon/osx/core/dao/DAO.sol";

contract SmartGuardian is IPermissionCondition, Ownable, Pausable {
    bytes32 private constant EXECUTE_PERMISSION_ID =
        keccak256("EXECUTE_PERMISSION");

    mapping(address => bool) public allowedExecutor;
    mapping(bytes32 => bool) public blockedProposal;

    error WrongPermissionId(bytes32 expected, bytes32 actual);

    function addExecutor(address _account) external onlyOwner {
        require(allowedExecutor[_account] == false);
        allowedExecutor[_account] = true;
    }

    function removeExecutor(address _account) external onlyOwner {
        require(allowedExecutor[_account] == true);
        allowedExecutor[_account] = false;
    }

    function blockProposal(bytes32 _proposalId) external onlyOwner {
        require(blockedProposal[_proposalId] == false);
        blockedProposal[_proposalId] = true;
    }

    function unblockProposal(bytes32 _proposalId) external onlyOwner {
        require(blockedProposal[_proposalId] == true);
        blockedProposal[_proposalId] = false;
    }

    /// @inheritdoc IPermissionCondition
    function isGranted(
        address _where,
        address _who,
        bytes32 _permissionId,
        bytes calldata _data
    ) external view whenNotPaused returns (bool allowed) {
        (_where);

        if (_permissionId != EXECUTE_PERMISSION_ID) {
            revert WrongPermissionId({
                expected: EXECUTE_PERMISSION_ID,
                actual: _permissionId
            });
        }

        // Decode the `_data` that was send to the `dao.excute()` function.
        (bytes32 _proposalId, , ) = abi.decode(
            _data,
            (bytes32, IDAO.Action[], uint256)
        );

        return allowedExecutor[_who] && !blockedProposal[_proposalId];
    }
}
