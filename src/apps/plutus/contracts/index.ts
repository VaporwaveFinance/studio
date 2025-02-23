import { Injectable, Inject } from '@nestjs/common';

import { IAppToolkit, APP_TOOLKIT } from '~app-toolkit/app-toolkit.interface';
import { ContractFactory } from '~contract/contracts';
import { Network } from '~types/network.interface';

import { PlsDpxPlutusChef__factory } from './ethers';
import { PlsJonesPlutusChef__factory } from './ethers';
import { PlsPlutusChef__factory } from './ethers';
import { PlutusEpochStaking__factory } from './ethers';

// eslint-disable-next-line
type ContractOpts = { address: string; network: Network };

@Injectable()
export class PlutusContractFactory extends ContractFactory {
  constructor(@Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit) {
    super((network: Network) => appToolkit.getNetworkProvider(network));
  }

  plsDpxPlutusChef({ address, network }: ContractOpts) {
    return PlsDpxPlutusChef__factory.connect(address, this.appToolkit.getNetworkProvider(network));
  }
  plsJonesPlutusChef({ address, network }: ContractOpts) {
    return PlsJonesPlutusChef__factory.connect(address, this.appToolkit.getNetworkProvider(network));
  }
  plsPlutusChef({ address, network }: ContractOpts) {
    return PlsPlutusChef__factory.connect(address, this.appToolkit.getNetworkProvider(network));
  }
  plutusEpochStaking({ address, network }: ContractOpts) {
    return PlutusEpochStaking__factory.connect(address, this.appToolkit.getNetworkProvider(network));
  }
}

export type { PlsDpxPlutusChef } from './ethers';
export type { PlsJonesPlutusChef } from './ethers';
export type { PlsPlutusChef } from './ethers';
export type { PlutusEpochStaking } from './ethers';
