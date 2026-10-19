import TBLogo from '../assets/tizenbrew.svg';
import { useContext } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { GlobalStateContext } from '../components/ClientContext.jsx';

export default function About() {
    const { state } = useContext(GlobalStateContext);
    const { t } = useTranslation();
    const tizenVersion = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
    const tvModel = tizen.systeminfo.getCapability('http://tizen.org/system/model_name');
    const appVersion = tizen.application.getCurrentApplication().appInfo.version;
    const modules = state.sharedData.modules || [];
    const videoClient = modules.find(module => module.fullName === 'npm/@foxreis/tizentube' ||
        module.fullName.indexOf('npm/@foxreis/tizentube@') === 0);

    return (
        <div className="flex flex-col items-center px-8 py-6 text-gray-300">
            <img src={TBLogo} className="h-[12vh] w-auto" />
            <p className="mt-2 text-base/7">App Version: {appVersion} · Tizen Version: {tizenVersion} · TV Model: {tvModel}</p>
            <div className="w-full max-w-5xl mt-6 rounded-3xl bg-gray-900 p-6">
                <h2 className="text-indigo-400 text-xl font-semibold">{t('about.setupTitle')}</h2>
                <p className="mt-2 text-base/7">{t('about.setupInstructions')}</p>
                <h2 className="text-indigo-400 text-xl font-semibold mt-6">{t('about.clientTitle')}</h2>
                <p className="mt-2 text-base/7">{videoClient && videoClient.version
                    ? t('about.clientVersion', { version: videoClient.version })
                    : t('about.clientNotLoaded')}</p>
                <p className="mt-2 text-base/7">{t('about.clientSource')}</p>
                <p className="mt-2 text-base/7">{t('about.clientRefresh')}</p>
            </div>
        </div>
    );
}
